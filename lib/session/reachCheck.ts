// ============================================================
// lib/session/reachCheck.ts
// ============================================================
// The range check: one guided raise of each arm before its first exercise
// (the owner's idea, v0.12.0). "Lift your right arm forward, as high as is
// comfortable, and hold it there." Not a rep and not judged. It tells us,
// before rep 1:
//   - the patient's comfortable range today (saved for the physio),
//   - where their hand really is when the measured angle makes the target,
//     so the hand circle is right from the first rep (it used to start too
//     low and only move once the target had been reached once),
//   - how the measured angle compares with BlazePose's 3D estimate for this
//     person and camera (`AngleBias`), for the circle when the target isn't
//     reached.
// "Comfortable", not "as high as you can": these are rehab patients.
// Pure: the screen feeds it frames and speaks what it returns. Tested by
// reachCheck.test.ts.
// ============================================================

export type ReachStage = "intro" | "up" | "hold" | "down" | "done";
export type HandOffset = { dx: number; dy: number };
export type ReachSample = { off: HandOffset | null; straight: boolean; elev3d: number | null };
export type ReachResult = {
  peak: number | null;        // highest measured angle (the scale reps are judged on)
  peak3d: number | null;      // BlazePose's 3D estimate at the top, when it had one
  reached: boolean;           // the peak made the exercise's target
  skipped: null | "no_lift";  // the patient never lifted
  offsets: HandOffset[];      // hand positions when the measured angle was at the target, straight arm
  bias: number | null;        // median (3D - measured) near the top
};

export const STEADY_MS = 1200;   // at the top, steady this long...
export const HOLD_MS = 1500;     // ...then held this long, then "and slowly down"
export const STEADY_BAND = 5;    // within this of the peak counts as steady
export const REMIND_MS = 12000;  // no lift yet: say it once more
export const GIVE_UP_MS = 25000; // still no lift: carry on without it
export const DOWN_MS = 7000;     // lowering takes at most this long
export const NEAR_TARGET = 5;    // hand positions are noted within this of the target

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export class ReachCheck {
  stage: ReachStage = "intro";
  private began: number;
  private reminded = false;
  private peak: number | null = null;
  private peak3d: number | null = null;
  private steadySince: number | null = null;
  private holdSince: number | null = null;
  private downSince: number | null = null;
  private offsets: HandOffset[] = [];
  private diffs: number[] = [];
  private skipped: ReachResult["skipped"] = null;
  private introSaid = false;

  constructor(
    private o: { side: "right" | "left"; start: number; target: number; nowMs: number }
  ) {
    this.began = o.nowMs;
  }

  /** Feed one frame; returns a line to say now, or null. `canSpeak`: nothing else is talking. */
  update(nowMs: number, metric: number | null, s: ReachSample, canSpeak = true): string | null {
    const side = this.o.side;
    if (this.stage === "done") return null;
    if (this.stage === "intro") {
      if (!this.introSaid) {
        if (!canSpeak) { this.began = nowMs; return null; } // the clock starts once it has been asked
        this.introSaid = true;
        this.began = nowMs;
        return `Before we begin, let's see how far your ${side} arm goes today. Lift it forward, as high as is comfortable, and hold it there.`;
      }
      if (metric !== null && metric >= this.o.start) { this.stage = "up"; }
      else if (!this.reminded && nowMs - this.began >= REMIND_MS && canSpeak) {
        this.reminded = true;
        return `Lift your ${side} arm forward, as high as is comfortable.`;
      } else if (nowMs - this.began >= GIVE_UP_MS) {
        this.skipped = "no_lift";
        this.stage = "done";
        return "That's all right. Let's start the exercise.";
      } else return null;
    }
    if (metric === null) return null;

    // Up and at the top: track the peak, note the hand near the target.
    if (this.stage === "up" || this.stage === "hold") {
      if (Math.abs(metric - this.o.target) <= NEAR_TARGET && s.straight && s.off) this.offsets = [...this.offsets, s.off].slice(-15);
      if (s.elev3d !== null && metric >= this.o.start && s.straight) this.diffs = [...this.diffs, s.elev3d - metric].slice(-60);
      if (this.peak === null || metric > this.peak) {
        this.peak = metric;
        if (s.elev3d !== null) this.peak3d = s.elev3d;
      }
    }

    if (this.stage === "up") {
      const p = this.peak!;
      if (metric >= p - STEADY_BAND && p >= this.o.start + 15) {
        this.steadySince ??= nowMs;
        if (nowMs - this.steadySince >= STEADY_MS) { this.stage = "hold"; this.holdSince = nowMs; }
      } else this.steadySince = null;
      // Came down without holding: the peak still counts.
      if (metric < p - 15 && p >= this.o.start + 15) { this.stage = "down"; this.downSince = nowMs; return "Thank you. And slowly down."; }
      if (metric < this.o.start - 5) { this.stage = "intro"; this.steadySince = null; } // a false start
      return null;
    }
    if (this.stage === "hold") {
      if (nowMs - this.holdSince! >= HOLD_MS || metric < this.peak! - 15) {
        this.stage = "down";
        this.downSince = nowMs;
        return "That's great. And slowly down.";
      }
      return null;
    }
    // down
    if (metric < this.o.start || nowMs - this.downSince! >= DOWN_MS) {
      this.stage = "done";
      return this.peak !== null && this.peak >= this.o.target
        ? "Thank you. Now the exercise."
        : "Thank you. We'll work towards a little higher. Now the exercise.";
    }
    return null;
  }

  result(): ReachResult {
    return {
      peak: this.peak,
      peak3d: this.peak3d,
      reached: this.peak !== null && this.peak >= this.o.target,
      skipped: this.skipped,
      offsets: this.offsets.slice(-7),
      bias: median(this.diffs.slice(-30)),
    };
  }
}

/**
 * How much higher BlazePose's 3D angle reads than the measured one near the
 * top, for this person and camera. Facing the camera the measured angle
 * reads about 20-25° low near overhead, so the circle placed by geometry at
 * the target sat too low until the patient had reached it once (the owner's
 * v0.11.0 screenshots). Learned from the range check and from every lift.
 */
export class AngleBias {
  private diffs: number[] = [];
  seed(bias: number | null) { if (bias !== null) this.diffs = Array(10).fill(bias); }
  reset() { this.diffs = []; }
  add(metric: number | null, elev3d: number | null, straight: boolean) {
    if (metric === null || elev3d === null || !straight || metric < 70) return;
    this.diffs = [...this.diffs, elev3d - metric].slice(-40);
  }
  /** Degrees to add to the target for the geometric circle (0 until known, never negative, at most 35). */
  get(): number {
    const m = median(this.diffs);
    return m === null || this.diffs.length < 5 ? 0 : Math.max(0, Math.min(35, m));
  }
}
