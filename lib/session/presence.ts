// ============================================================
// lib/session/presence.ts
// ============================================================
// Is the patient really in front of the camera? The owner's run
// (A-F62E49B6): with nobody there, a single stray pose (the model briefly
// "finding" someone) counted as the patient coming back, so the session
// flipped between "I can't see you" and "Welcome back" five times, and the
// rep counter ran on the stray frames ("rep failed" read out each time).
//
// `seenInFrame` asks for a person with both shoulders clearly seen;
// `PresenceTracker` only changes its mind after a steady run of frames:
// back after BACK_AFTER_MS of seeing them, gone after GONE_AFTER_MS of not
// (a short dropout while moving is ignored). Pure. Tested by presence.test.ts.
// ============================================================

export const BACK_AFTER_MS = 1500;
export const GONE_AFTER_MS = 1000;
export const MIN_SHOULDER_SCORE = 0.5;

type Lm = { x: number; y: number; score?: number } | undefined;

/** A person, with both shoulders clearly seen (stray detections rarely have them). */
export function seenInFrame(frame: { personDetected: boolean; landmarks: Record<string, Lm> } | null | undefined): boolean {
  if (!frame || !frame.personDetected) return false;
  const l = frame.landmarks.left_shoulder, r = frame.landmarks.right_shoulder;
  return !!l && !!r && (l.score ?? 1) >= MIN_SHOULDER_SCORE && (r.score ?? 1) >= MIN_SHOULDER_SCORE;
}

export class PresenceTracker {
  present = true;
  /** The last moment the patient counted as present (for the walk-away timer). */
  lastPresentMs: number;
  private flipSince: number | null = null;

  constructor(nowMs: number) {
    this.lastPresentMs = nowMs;
  }

  reset(nowMs: number) {
    this.present = true;
    this.lastPresentMs = nowMs;
    this.flipSince = null;
  }

  update(nowMs: number, seen: boolean): boolean {
    if (seen === this.present) {
      this.flipSince = null;
    } else {
      this.flipSince ??= nowMs;
      if (nowMs - this.flipSince >= (seen ? BACK_AFTER_MS : GONE_AFTER_MS)) {
        this.present = seen;
        this.flipSince = null;
      }
    }
    if (this.present) this.lastPresentMs = nowMs;
    return this.present;
  }
}
