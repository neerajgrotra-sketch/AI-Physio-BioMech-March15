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
//
// The other moments already have their lines elsewhere: the exercise
// intro, "Hold it there" and the countdown, the rep-completed praise with
// "Now lower your arm slowly", the failure lines (useCoachingBrain).
// Tested by repCoach.test.ts.
// ============================================================

export type RepCoachInput = {
  nowMs: number;
  phase: string;              // ready | lifting | top | holding | lowering | complete
  metric: number | null;      // the measured angle now
  target: number;
  repCount: number;
  repTarget: number;
  elbowBent: boolean | null;  // facing the camera only, else null
  wrongPlane: boolean | null; // forward raise going out to the side, else null
};

export const STALL_MS = 1500;          // no real progress for this long while lifting
export const STALL_PROGRESS_DEG = 3;
export const NEAR_TARGET_DEG = 5;      // within this of the target, don't say "higher"
export const FORM_PERSIST_MS = 700;    // a form problem must last this long
export const AGAIN_AFTER_MS = 1500;    // after the rep, at rest this long -> "And again."
const COOLDOWN_MS: Record<string, number> = { higher: 3500, straight: 5000, plane: 5000, better: 4000 };

export class RepCoach {
  private phase = "";
  private phaseSince = 0;
  private best: { v: number; at: number } | null = null; // best angle this lift, and when
  private bentSince: number | null = null;
  private planeSince: number | null = null;
  private lastSaid: Record<string, number> = {};
  private againForRep = -1;
  private planeCued = false; // "in front of you" was said during this lift

  reset(): void {
    this.phase = "";
    this.phaseSince = 0;
    this.best = null;
    this.bentSince = null;
    this.planeSince = null;
    this.lastSaid = {};
    this.againForRep = -1;
    this.planeCued = false;
  }

  private can(kind: string, now: number): boolean {
    const last = this.lastSaid[kind];
    return last === undefined || now - last >= (COOLDOWN_MS[kind] ?? 4000);
  }

  private say(kind: string, now: number, text: string): string {
    this.lastSaid[kind] = now;
    return text;
  }

  update(i: RepCoachInput): string | null {
    const now = i.nowMs;
    if (i.phase !== this.phase) {
      this.phase = i.phase;
      this.phaseSince = now;
      if (i.phase === "lifting") this.best = null;
      if (i.phase === "ready") this.planeCued = false;
    }
    const active = i.phase === "lifting" || i.phase === "top" || i.phase === "holding";

    // Form first: it matters more than height.
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
      const stalled = now - this.best.at >= STALL_MS && now - this.phaseSince >= STALL_MS;
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
