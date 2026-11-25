// ============================================================
// lib/exercises/kneeThresholds.ts
// ============================================================
// Knee-extension thresholds in the angle the app measures.
//
// The app measures the INTERIOR knee angle (hip-knee-ankle):
//   ~90° seated with the foot on the floor -> ~180° leg straight.
// The rep logic counts UP (start < target), which suits that.
//
// The exercise_templates rows store knee ROM the clinical way, as
// FLEXION: 90 = bent (rom_start_degrees), 0 = straight
// (rom_norm_degrees), and rom_acceptable_min = 30 means "within 30°
// of straight". Feeding those numbers straight in made the target
// (30) lower than the start (105), so reps could never work.
// Tested by lib/exercises/kneeThresholds.test.ts.
// ============================================================

export type KneeThresholds = {
  startThreshold: number;
  targetThreshold: number;
  finishThreshold: number;
  targetValue: number;
  tolerance: number;
};

/** Flexion (0 = straight) -> interior angle (180 = straight). */
export function flexionToInterior(flexionDeg: number): number {
  return 180 - flexionDeg;
}

/**
 * A physio target for a knee may arrive in either convention. Values
 * of 90 or less are read as flexion (degrees short of straight), as the
 * templates store them; larger values are already interior angles.
 */
export function kneeTargetToInterior(deg: number): number {
  return deg <= 90 ? flexionToInterior(deg) : deg;
}

export function kneeExtensionThresholds(opts: {
  romStartDegrees: number | null;     // flexion at rest, e.g. 90
  romNormDegrees: number | null;      // flexion at the goal, e.g. 0
  romAcceptableMin: number | null;    // flexion that still counts, e.g. 30
  romTargetDegrees: number | null;    // physio's per-patient target, either convention
}): KneeThresholds {
  const rest = flexionToInterior(opts.romStartDegrees ?? 90);
  const goal = flexionToInterior(opts.romNormDegrees ?? 0);
  const target =
    opts.romTargetDegrees != null
      ? kneeTargetToInterior(opts.romTargetDegrees)
      : flexionToInterior(opts.romAcceptableMin ?? 30);

  const startThreshold = rest + 15;
  const finishThreshold = rest + 10;
  // Keep at least 20° of travel between start and target.
  const targetThreshold = Math.min(178, Math.max(target, startThreshold + 20));

  return {
    startThreshold,
    targetThreshold,
    finishThreshold,
    targetValue: Math.max(goal, targetThreshold),
    tolerance: 12,
  };
}
