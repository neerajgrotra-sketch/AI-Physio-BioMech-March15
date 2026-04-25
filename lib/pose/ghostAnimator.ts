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
  nowMs: number;             // performance.now()
};

export function computeGhostAnim(input: GhostAnimInput): GhostAnimState {
  const { infPhase, holdRemainingMs, holdTotalMs, repsDone, readyElapsedS, nowMs } = input;

  let ghostT    = 0;
  let opacity   = 0.72;
  let isHolding = false;
  let badgePhase: GhostAnimState['badgePhase'] = 'attempt';

  if (infPhase === 'ready' || infPhase === 'idle') {
    if (repsDone === 0) {
      // Teaching animation before first rep: oscillate 0→1→0
      // so patient can see the full movement range
      ghostT   = 0.5 + 0.5 * Math.sin(nowMs / 3200);
      opacity  = 0.65;
      badgePhase = 'demo';
    } else if (readyElapsedS < 5) {
      // Between reps: ghost dims at rest
      ghostT   = 0;
      opacity  = 0.18 + 0.08 * Math.sin(nowMs / 900);
      badgePhase = 'attempt';
    } else {
      // Encouragement ramp after 5s: ghost rises to invite next rep
      ghostT   = Math.min(1, (readyElapsedS - 5) / 6);
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
    // Pulse between 40–75% to signal "come back down slowly"
    ghostT     = 0.4 + 0.35 * Math.sin(nowMs / 800);
    opacity    = 0.72;
    badgePhase = 'attempt';
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
