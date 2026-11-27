// ============================================================
// lib/coaching/plainHeight.ts
// ============================================================
// How high to lift, in words a patient understands (the owner's testers:
// "Raise to 130°" means nothing to a patient). Arm elevation from straight
// down: 90 = level with the shoulder, 180 = straight up. Degrees stay in the
// physio's panels and the logs; patients see and hear these phrases, with
// the elbow marker showing the exact height. Pure. Tested by plainHeight.test.ts.
// ============================================================

/** Where the lift should reach, as a short phrase ("to shoulder height"). */
export function heightPhrase(targetDeg: number): string {
  if (targetDeg <= 75) return "almost to shoulder height";
  if (targetDeg <= 100) return "to shoulder height";
  if (targetDeg <= 125) return "just above your shoulder";
  if (targetDeg <= 150) return "up to head height";
  if (targetDeg <= 170) return "high above your head";
  return "straight up above your head";
}

/** The guide's resting caption: what to do, in plain words. */
export function liftCaption(targetDeg: number): string {
  return `Straight arm, ${heightPhrase(targetDeg)}`;
}

/**
 * The target in plain words for any exercise, from its metric: arm raises by
 * height, knee extensions by how straight the leg gets (interior knee angle,
 * 180 = straight), nothing for sit to stand (a stand is a stand).
 */
export function targetPhrase(metric: string | null | undefined, targetDeg: number | null | undefined): string | null {
  if (targetDeg === null || targetDeg === undefined || !metric) return null;
  if (/Arm|Abduction/i.test(metric)) return heightPhrase(targetDeg);
  if (/Knee/i.test(metric)) return targetDeg >= 165 ? "until your leg is straight" : "most of the way straight";
  return null;
}
