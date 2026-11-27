// ============================================================
// lib/app/sessionDuration.ts
// ============================================================
// How long a protocol takes, worked out from its exercises (the owner's
// report: every protocol showed the typed-in default of 10 min). Shared by
// the admin cards, the protocol form and the session screen, so all three
// agree. Pure. Tested by sessionDuration.test.ts.
// ============================================================

export const GREETING_S = 15;   // the spoken greeting, once per session
export const SETUP_S = 45;      // per exercise: getting placed, the demonstration
export const MOVE_S = 4;        // per rep: raising and lowering

export type DurationExercise = { reps: number; holdMs: number };

/** Seconds for one exercise: set-up plus each rep's movement and hold. */
export function exerciseSeconds(e: DurationExercise): number {
  const reps = Math.max(0, e.reps || 0);
  const hold = Math.max(0, e.holdMs || 0) / 1000;
  return SETUP_S + reps * (MOVE_S + hold);
}

/** Seconds for a whole session (greeting included); 0 with no exercises. */
export function sessionSeconds(list: DurationExercise[]): number {
  if (list.length === 0) return 0;
  return GREETING_S + list.reduce((s, e) => s + exerciseSeconds(e), 0);
}

/** Whole minutes, rounded up, at least 1 when there is anything to do. */
export function sessionMinutes(list: DurationExercise[]): number {
  const s = sessionSeconds(list);
  return s === 0 ? 0 : Math.max(1, Math.ceil(s / 60));
}
