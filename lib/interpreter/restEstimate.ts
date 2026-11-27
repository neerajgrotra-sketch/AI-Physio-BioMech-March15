// ============================================================
// lib/interpreter/restEstimate.ts
// ============================================================
// Where the OTHER arm rests, for the isolation check (movementInterpreter)
// and the wrong-arm call (RepCoach). One rule for both:
//   - learned only while waiting between reps (the caller decides);
//   - moves slowly, a share of the gap each frame (about 3 s to settle), in
//     BOTH directions, so a brief glitch can't drag it;
//   - ignores readings more than REST_TRACK_DEG above it, so a lifted arm
//     never becomes the "rest".
// History: v0.6.0 averaged 10% a frame, so a slow lift was followed and the
// wrong arm never called; v0.6.1 followed DOWN quickly, so a camera dip
// (the left arm read 10° for a moment, run A-A4D8281D) dragged the rest
// down and the resting arm then looked lifted: every hold failed isolation
// and "That's your left arm" repeated. Tested by restEstimate.test.ts.
// ============================================================

export const REST_TRACK_DEG = 10;
export const REST_TAU_MS = 3000;

/** The next rest estimate after one reading; `share` 0..1 of the gap to move. */
export function nextRest(rest: number | null, value: number | null | undefined, share: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return rest;
  if (rest === null) return value;
  if (value - rest > REST_TRACK_DEG) return rest;
  return rest + (value - rest) * Math.max(0, Math.min(1, share));
}

/** The share for a time step (ms), for callers that know the frame time. */
export const restShareFor = (dtMs: number) => Math.max(0, Math.min(1, dtMs / REST_TAU_MS));

/** The share per frame at about 30 frames a second (for per-frame callers). */
export const REST_SHARE_PER_FRAME = restShareFor(1000 / 30);
