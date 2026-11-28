// ============================================================
// lib/coaching/repCoach.ts
// ============================================================
// What a physio says DURING a rep, from what the patient is doing right
// now (the owner's request: coach the person through the rep, not repeat
// blindly). Pure: feed it each frame, it returns at most one short line to
// say, with its own pacing so it never nags.
//
//   lifting, stalled below the target   -> "A little higher."
//   elbow bent while raising / holding   -> "Keep your arm straight."
//   arm going out to the side (forward
//   raise)                               -> "Bring your arm in front of you."
//   corrected that while still going up  -> "That's better."
//     (corrected at the target, the hold starts and "Hold it there" plays)
//   back at rest after a rep             -> "And again."
//   the OTHER arm lifted, exercise arm
//   still down (the mirror confuses)     -> "That's your left arm. Rest it down and lift your right arm."
//
// The other moments already have their lines elsewhere: the exercise
// intro, "Hold it there" and the countdown, the rep-completed praise with
// "Now lower your arm slowly", the failure lines (useCoachingBrain).
// Tested by repCoach.test.ts.
// ============================================================

import { nextRest, restShareFor, REST_TAU_MS } from "@/lib/interpreter/restEstimate";

export type RepCoachInput = {
  nowMs: number;
  phase: string;              // ready | lifting | top | holding | lowering | complete
  metric: number | null;      // the measured angle now
  target: number;
  repCount: number;
  repTarget: number;
  elbowBent: boolean | null;  // facing the camera only, else null
  wrongPlane: boolean | null; // forward raise going out to the side, else null
  /** This lift went up out to the side (lib/interpreter/liftPath.ts): it won't count however it ends. */
  wrongPath?: boolean;
  /** One-arm exercises: which arm it is, and the OTHER arm's elevation now. */
  side?: "right" | "left" | "both";
  oppositeMetric?: number | null;
  startThreshold?: number;     // the exercise arm counts as down below this
};

export const STALL_MS = 1500;          // no real progress for this long while lifting
export const STALL_PROGRESS_DEG = 3;
export const NEAR_TARGET_DEG = 5;      // within this of the target, don't say "higher"
export const FORM_PERSIST_MS = 700;    // a form problem must last this long
export const AGAIN_AFTER_MS = 1500;    // after the rep, at rest this long -> "And again."
export const WRONG_ARM_RISE_DEG = 30;  // the other arm this far above its rest = it's being lifted
export const WRONG_ARM_PERSIST_MS = 400; // quicker than other form cues: it's an obvious mistake
export const WRONG_ARM_MIN_GAP_MS = 2000;
// Where the other arm rests: lib/interpreter/restEstimate.ts (shared with the
// isolation check; its history explains the v0.6.0 and v0.6.1 failures).
export const WRONG_ARM_MAX_CALLS = 3;
export const WRONG_ARM_BACKOFF_MS = 20000;
const COOLDOWN_MS: Record<string, number> = { higher: 3500, straight: 5000, plane: 5000, better: 4000, wrongArm: 4000 };

/** Adjustable from the Coach Lab (lib/coach/coachSettings.ts); defaults = the constants above. */
export type RepCoachOptions = { stallMs?: number; wrongArmRiseDeg?: number; wrongArmPersistMs?: number; restTauMs?: number };

export class RepCoach {
  private opt: Required<RepCoachOptions>;
  constructor(o: RepCoachOptions = {}) {
    this.opt = {
      stallMs: o.stallMs ?? STALL_MS,
      wrongArmRiseDeg: o.wrongArmRiseDeg ?? WRONG_ARM_RISE_DEG,
      wrongArmPersistMs: o.wrongArmPersistMs ?? WRONG_ARM_PERSIST_MS,
      restTauMs: o.restTauMs ?? REST_TAU_MS,
    };
  }
  /** Change the adjustable values (keeps what the coach has learned). */
  configure(o: RepCoachOptions): void {
    this.opt = { ...this.opt, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) } as Required<RepCoachOptions>;
  }
  private phase = "";
  private phaseSince = 0;
  private best: { v: number; at: number } | null = null; // best angle this lift, and when
  private bentSince: number | null = null;
  private planeSince: number | null = null;
  private lastSaid: Record<string, number> = {};
  private againForRep = -1;
  private planeCued = false; // "in front of you" was said during this lift
  private pathCued = false;  // "that went out to the side" was said for this lift
  private wrongArmCalls = 0; // wrong-arm calls since the right arm last lifted
  private oppRest: number | null = null;  // where the other arm rests
  private wrongArmSince: number | null = null;
  /** True while the patient is lifting the wrong arm (for the on-screen highlight). */
  wrongArmNow = false;
  /** When the patient last moved either arm noticeably (to hold back re-demonstrations). */
  lastActivityMs = -Infinity;
  /** The kind of the line just returned ("wrongArm" is a correction: say it over anything else). */
  lastKind: string | null = null;
  private wrongArmEpisode = false; // this wrong lift has been called out
  private lastOpp: number | null = null;
  private lastMetric: number | null = null;
  private lastNow: number | null = null;

  reset(): void {
    this.phase = "";
    this.phaseSince = 0;
    this.best = null;
    this.bentSince = null;
    this.planeSince = null;
    this.lastSaid = {};
    this.againForRep = -1;
    this.wrongArmCalls = 0;
    this.planeCued = false;
    this.pathCued = false;
    this.oppRest = null;
    this.wrongArmSince = null;
    this.wrongArmNow = false;
    this.lastActivityMs = -Infinity;
    this.lastKind = null;
    this.wrongArmEpisode = false;
    this.lastOpp = null;
    this.lastMetric = null;
    this.lastNow = null;
  }

  private can(kind: string, now: number): boolean {
    const last = this.lastSaid[kind];
    return last === undefined || now - last >= (COOLDOWN_MS[kind] ?? 4000);
  }

  private say(kind: string, now: number, text: string): string {
    this.lastSaid[kind] = now;
    this.lastKind = kind;
    return text;
  }

  update(i: RepCoachInput): string | null {
    const now = i.nowMs;
    const dt = this.lastNow === null ? 0 : Math.max(0, Math.min(500, now - this.lastNow));
    this.lastNow = now;
    this.lastKind = null;
    // Any noticeable arm movement (either arm) counts as activity.
    const moved = (a: number | null | undefined, b: number | null) => a !== null && a !== undefined && b !== null && Math.abs(a - b) > 1.5;
    if (moved(i.metric, this.lastMetric) || moved(i.oppositeMetric, this.lastOpp)) this.lastActivityMs = now;
    this.lastMetric = i.metric ?? null;
    this.lastOpp = i.oppositeMetric ?? null;
    if (i.phase !== this.phase) {
      this.phase = i.phase;
      this.phaseSince = now;
      if (i.phase === "lifting") { this.best = null; this.wrongArmCalls = 0; }
      if (i.phase === "ready") { this.planeCued = false; this.pathCued = false; }
    }
    const active = i.phase === "lifting" || i.phase === "top" || i.phase === "holding";

    // The wrong arm: the other arm well above where it rests while the
    // exercise arm is still down. (Both up is "keep the other arm still",
    // judged by the rep logic.)
    const opp = i.oppositeMetric ?? null;
    const oneArm = i.side === "right" || i.side === "left";
    const exerciseArmDown = i.metric === null || i.metric < (i.startThreshold ?? 40);
    if (oneArm && opp !== null) {
      const lifted = this.oppRest !== null && opp > this.oppRest + this.opt.wrongArmRiseDeg;
      // Learned slowly while waiting between reps (lib/interpreter/restEstimate.ts).
      if (this.oppRest === null) this.oppRest = opp;
      else if (i.phase === "ready") this.oppRest = nextRest(this.oppRest, opp, restShareFor(dt, this.opt.restTauMs));
      this.wrongArmSince = lifted && exerciseArmDown ? (this.wrongArmSince ?? now) : null;
    } else {
      this.wrongArmSince = null;
    }
    this.wrongArmNow = this.wrongArmSince !== null && now - this.wrongArmSince >= this.opt.wrongArmPersistMs;
    if (!this.wrongArmNow) this.wrongArmEpisode = false;
    // Every new wrong lift is called out (at most every WRONG_ARM_MIN_GAP_MS),
    // and while the arm stays up the call repeats on the cooldown. (It used to
    // be said once: the guide's narration kept the voice busy, and each
    // further try fell inside a 5 s cooldown.)
    const last = this.lastSaid["wrongArm"];
    const newEpisode = this.wrongArmNow && !this.wrongArmEpisode && (last === undefined || now - last >= WRONG_ARM_MIN_GAP_MS);
    // After WRONG_ARM_MAX_CALLS calls with no lift of the right arm, back off
    // (the owner's run: it was said every 2-4 s for minutes).
    const backedOff = this.wrongArmCalls >= WRONG_ARM_MAX_CALLS && last !== undefined && now - last < WRONG_ARM_BACKOFF_MS;
    if (this.wrongArmNow && !backedOff && (newEpisode || this.can("wrongArm", now))) {
      this.wrongArmEpisode = true;
      this.wrongArmCalls++;
      const other = i.side === "right" ? "left" : "right";
      return this.say("wrongArm", now, `That's your ${other} arm. Rest it down and lift your ${i.side} arm.`);
    }

    // Form first: it matters more than height. A lift that went up out to
    // the side is a side raise: say so once and ask for a fresh one (moving
    // the arm in front at the top no longer rescues it).
    if (active && i.wrongPath) {
      if (!this.pathCued) {
        this.pathCued = true;
        this.planeCued = false;
        return this.say("plane", now, "That's out to the side. Lower your arm, and lift it forward, in front of you.");
      }
      return null;
    }
    this.planeSince = active && i.wrongPlane ? (this.planeSince ?? now) : null;
    if (this.planeSince !== null && now - this.planeSince >= FORM_PERSIST_MS && this.can("plane", now)) {
      this.planeCued = true;
      return this.say("plane", now, "Bring your arm in front of you.");
    }
    // Acknowledge the correction on the way up.
    if (this.planeCued && i.phase === "lifting" && i.wrongPlane === false && this.can("better", now)) {
      this.planeCued = false;
      return this.say("better", now, "That's better.");
    }
    this.bentSince = active && i.elbowBent ? (this.bentSince ?? now) : null;
    if (this.bentSince !== null && now - this.bentSince >= FORM_PERSIST_MS && this.can("straight", now)) {
      return this.say("straight", now, "Keep your arm straight.");
    }

    // Stalled on the way up.
    if (i.phase === "lifting" && i.metric !== null) {
      if (this.best === null || i.metric > this.best.v + STALL_PROGRESS_DEG) this.best = { v: i.metric, at: now };
      const stalled = now - this.best.at >= this.opt.stallMs && now - this.phaseSince >= this.opt.stallMs;
      if (stalled && i.metric < i.target - NEAR_TARGET_DEG && this.can("higher", now)) {
        this.best = { v: i.metric, at: now }; // give them another moment
        return this.say("higher", now, "A little higher.");
      }
    }

    // Back at rest after a rep: invite the next one, once per rep.
    if (
      i.phase === "ready" && i.repCount > 0 && i.repCount < i.repTarget &&
      this.againForRep !== i.repCount && now - this.phaseSince >= AGAIN_AFTER_MS
    ) {
      this.againForRep = i.repCount;
      return this.say("again", now, "And again.");
    }
    return null;
  }
}
