// lib/pose/ghostAnimator.ts
// ============================================================
// Pure animation driver — computes ghostT (0→1) and visual
// properties from inference phase state.
//
// NO exercise knowledge here. This function does not know what
// exercise is running — it only knows phase, timing, and reps.
//
// ghostT semantics:
//   0.0 = resting position (arm at side / leg hanging)
//   1.0 = target position  (arm at physio target / leg extended)
//
// The draw functions in ghostDrawers.ts interpolate between
// restDir and targetDir using ghostT.
// ============================================================

export type GhostAnimState = {
  /** 0–1 interpolation between rest and target positions */
  ghostT: number;
  /** Canvas opacity for the ghost overlay */
  opacity: number;
  /** Whether patient is currently in the hold phase */
  isHolding: boolean;
  /** Ghost colour R,G,B components (blue→green as ghostT rises) */
  colorRGB: { r: number; g: number; b: number };
  /** Which UI badge to show */
  badgePhase: 'demo' | 'attempt' | 'holding' | 'rep_complete';
  /** Hold elapsed ms for the hold ring (0 if not holding) */
  holdElapsedMs: number;
};

export type GhostAnimInput = {
  infPhase: string;          // from inferenceLoop.phase
  holdRemainingMs: number | null;
  holdTotalMs: number;       // prescription.hold.durationMs
  repsDone: number;          // inferenceLoop.repCount
  readyElapsedS: number;     // seconds since ready phase started
  loweringElapsedS?: number; // seconds since lowering started (rep just done)
  nowMs: number;             // performance.now()
};

/**
 * One demonstration rep, the way a physio shows it: rise (2 s), pause at
 * the target (1.2 s), lower (2 s), pause at rest (1 s), repeat. Eased so it
 * starts and stops gently. `s` is seconds since the demo began.
 */
export const DEMO_CYCLE_S = 6.2;
export function demoCycle(s: number): number {
  const t = ((s % DEMO_CYCLE_S) + DEMO_CYCLE_S) % DEMO_CYCLE_S;
  const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
  if (t < 2) return ease(t / 2);
  if (t < 3.2) return 1;
  if (t < 5.2) return 1 - ease((t - 3.2) / 2);
  return 0;
}

// After a rep, the ghost rests this long before showing the next one.
export const BETWEEN_REPS_REST_S = 1.5;
// It shows a rep once, then waits; only if the patient still hasn't moved
// after this long does it show it again (it used to loop non-stop).
export const IDLE_BEFORE_REPEAT_S = 8;

/**
 * Where the demonstration is at, `s` seconds after it could start: which
 * showing it is (0 = the first, 1+ = repeats after a long pause) and how
 * far into that showing, or null while the figure waits. One clock for the
 * figure's movement and the narration (lib/coaching/demoNarrator.ts), so
 * the voice says "up to here" exactly when the figure gets there.
 */
export function demoClock(s: number): { cycle: number; t: number } | null {
  if (s < 0) return null;
  if (s < DEMO_CYCLE_S) return { cycle: 0, t: s };
  const period = IDLE_BEFORE_REPEAT_S + DEMO_CYCLE_S;
  const k = Math.floor((s - DEMO_CYCLE_S) / period);
  const t = (s - DEMO_CYCLE_S) % period;
  return t < IDLE_BEFORE_REPEAT_S ? null : { cycle: k + 1, t: t - IDLE_BEFORE_REPEAT_S };
}

/** Demonstrate once, then wait; again only after a long pause. `s` = seconds since the demo could start. */
export function demoOnceThenWait(s: number): number {
  const c = demoClock(s);
  return c ? demoCycle(c.t) : 0;
}

export function computeGhostAnim(input: GhostAnimInput): GhostAnimState {
  const { infPhase, holdRemainingMs, holdTotalMs, repsDone, readyElapsedS, nowMs } = input;

  let ghostT    = 0;
  let opacity   = 0.72;
  let isHolding = false;
  let badgePhase: GhostAnimState['badgePhase'] = 'attempt';

  if (infPhase === 'ready' || infPhase === 'idle') {
    if (repsDone === 0) {
      // Teaching before the first rep: demonstrate the whole movement.
      ghostT   = demoOnceThenWait(readyElapsedS);
      opacity  = 0.7;
      badgePhase = 'demo';
    } else if (readyElapsedS < BETWEEN_REPS_REST_S) {
      // Just lowered: the ghost rests with the patient for a moment.
      ghostT   = 0;
      opacity  = 0.35;
      badgePhase = 'attempt';
    } else {
      // Then it shows the next rep, inviting the patient to go again.
      ghostT   = demoOnceThenWait(readyElapsedS - BETWEEN_REPS_REST_S);
      opacity  = 0.72;
      badgePhase = 'attempt';
    }
  } else if (infPhase === 'lifting') {
    ghostT     = 1;
    opacity    = 0.72;
    badgePhase = 'attempt';
  } else if (infPhase === 'top' || infPhase === 'holding') {
    ghostT     = 1;
    opacity    = 0.88;
    isHolding  = true;
    badgePhase = 'holding';
  } else if (infPhase === 'lowering') {
    // Rep done: the ghost lowers back to rest with the patient (eased over
    // about 2 s from when lowering began), showing where to come back to.
    const s = input.loweringElapsedS ?? 2;
    ghostT     = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, s / 2));
    opacity    = 0.72;
    badgePhase = 'rep_complete';
  } else if (infPhase === 'complete' || infPhase === 'bottom') {
    ghostT     = 1;
    opacity    = 1.0;
    badgePhase = 'rep_complete';
  } else {
    ghostT     = 1;
    opacity    = 0.60;
    badgePhase = 'attempt';
  }

  // Colour: interpolates blue (0%) → green (100%) as ghostT rises
  const t = ghostT;
  const colorRGB = {
    r: Math.floor(96  + (74  - 96)  * t),
    g: Math.floor(165 + (222 - 165) * t),
    b: Math.floor(250 + (128 - 250) * t),
  };

  // Hold elapsed — used by the hold countdown ring
  const holdElapsedMs = isHolding && holdRemainingMs !== null
    ? Math.max(0, holdTotalMs - holdRemainingMs)
    : 0;

  return { ghostT, opacity, isHolding, colorRGB, badgePhase, holdElapsedMs };
}
