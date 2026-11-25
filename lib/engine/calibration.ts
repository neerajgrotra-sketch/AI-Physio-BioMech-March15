// ============================================================
// lib/engine/calibration.ts
// ============================================================
// Resting-baseline calibration and the spike filter, pulled out of
// useInferenceLoop so they can be tested. Pure: no React, no time
// source of their own.
// Tested by lib/engine/calibration.test.ts.
// ============================================================

import type { ExercisePrescription, MetricSource } from "@/lib/types/exercise";
import type { MovementFeatures } from "@/lib/types/movement";

/** Which exercises get a resting-baseline calibration. */
export type CalibrationKind = "arm" | "none";

export function calibrationKindFor(metric: MetricSource): CalibrationKind {
  switch (metric) {
    case "rightArmElevationDeg":
    case "leftArmElevationDeg":
    case "bilateralArmElevationDeg":
    case "rightShoulderAbductionDeg":
    case "leftShoulderAbductionDeg":
    case "bilateralShoulderAbductionDeg":
      return "arm";
    default:
      // Knee angles and sit-to-stand use absolute thresholds.
      return "none";
  }
}

/**
 * The feature fields a metric reads. A bilateral metric is judged on
 * min(left, right), so both sides must be filtered, not only the average.
 */
export function featureKeysFor(metric: MetricSource): Array<keyof MovementFeatures> {
  switch (metric) {
    case "rightArmElevationDeg": return ["rightArmElevationDeg"];
    case "leftArmElevationDeg": return ["leftArmElevationDeg"];
    case "bilateralArmElevationDeg": return ["leftArmElevationDeg", "rightArmElevationDeg", "bilateralArmElevationDeg"];
    case "rightShoulderAbductionDeg": return ["rightShoulderAbductionDeg"];
    case "leftShoulderAbductionDeg": return ["leftShoulderAbductionDeg"];
    case "bilateralShoulderAbductionDeg": return ["leftShoulderAbductionDeg", "rightShoulderAbductionDeg", "bilateralShoulderAbductionDeg"];
    case "rightKneeExtensionDeg": return ["kneeAngleRight"];
    case "leftKneeExtensionDeg": return ["kneeAngleLeft"];
    case "bilateralKneeExtensionDeg":
    case "kneeToHipExtensionScore": return ["kneeAngleLeft", "kneeAngleRight"];
    default: return [];
  }
}

// A resting arm reads well under this, even with the hand resting on a desk
// or the lap (upper arm 30-40° forward). If the 10th percentile of the
// calibration window is higher, the patient was moving and the reading is
// capped so the targets stay sane.
export const MAX_BASELINE_DEG = 45;

// How far back down from the target the arm must come for a rep to finish,
// as a share of the way from rest to target.
export const FINISH_SHARE = 0.3;

export type CalibratedThresholds = {
  baseline: number;
  start: number;
  target: number;
  finish: number;
  tolerance: number;
};

/**
 * Thresholds from the resting samples taken in the first seconds.
 *
 * - baseline: the 10th percentile of the samples (rest is the lowest
 *   reading; movement only pushes values up), capped at MAX_BASELINE_DEG.
 * - finish = baseline + 30% of the way to the target (at least 10°): a rep
 *   counts once the arm comes back most of the way down. It used to be
 *   baseline + 10, so a patient who rested a hand on the desk between reps
 *   (upper arm 30-40° forward) never came down far enough and no rep counted.
 * - start = the higher of baseline + 15 and finish + 5, so a rep starts above
 *   where the last one finished.
 * - target: the physio's target if set, else the population minimum.
 *   It is NOT shifted by the baseline any more. A resting arm that reads
 *   15° does not mean every angle reads 15° too high, and the shift made
 *   a 110° target into ~125°, so patients failed "not high enough".
 *   The target is kept at least 20° above start so a rep has a range.
 * - tolerance: how far below the target a hold may sag. With a physio
 *   target above the population minimum, the hold may sag to the minimum.
 */
export function calibrateThresholds(
  samples: number[],
  opts: { romAcceptableMin: number | null; romTargetDegrees: number | null }
): CalibratedThresholds | null {
  const valid = samples.filter((v) => Number.isFinite(v) && v >= 0);
  if (valid.length < 5) return null;

  const sorted = [...valid].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const baseline = Math.min(p10, MAX_BASELINE_DEG);

  const effectiveTarget = opts.romTargetDegrees ?? opts.romAcceptableMin;
  if (effectiveTarget == null) return null;

  const round1 = (v: number) => Math.round(v * 10) / 10;
  const finish = round1(baseline + Math.max(10, FINISH_SHARE * (effectiveTarget - baseline)));
  const start = round1(Math.max(baseline + 15, finish + 5));
  const target = Math.max(effectiveTarget, start + 20);

  const floor =
    opts.romTargetDegrees != null && opts.romAcceptableMin != null && opts.romAcceptableMin < target
      ? opts.romAcceptableMin
      : target - 12;
  const tolerance = Math.max(10, target - floor);

  return { baseline, start, target, finish, tolerance };
}

/** Writes calibrated thresholds onto the prescription the loop is running. */
export function applyThresholds(prescription: ExercisePrescription, t: CalibratedThresholds): void {
  prescription.startThreshold = t.start;
  prescription.targetThreshold = t.target;
  prescription.finishThreshold = t.finish;
  if (prescription.target) prescription.target.tolerance = t.tolerance;
}

/**
 * Rejects single-frame jumps (pose-model glitches), but accepts a big
 * change that holds for `confirmFrames` frames in a row. The old filter
 * never accepted a jump at all, so after one real fast move (or a
 * tracking gap) the reading froze on a stale value.
 */
export class SpikeFilter {
  private last: number | null = null;
  private pending = 0;

  constructor(
    private readonly thresholdDeg: number,
    private readonly confirmFrames = 3
  ) {}

  filter(value: number | null): number | null {
    if (value === null) return null; // a gap is not a spike; keep `last` for when it returns
    if (this.last === null || Math.abs(value - this.last) <= this.thresholdDeg) {
      this.last = value;
      this.pending = 0;
      return value;
    }
    this.pending += 1;
    if (this.pending >= this.confirmFrames) {
      this.last = value;
      this.pending = 0;
      return value;
    }
    return this.last;
  }

  reset(): void {
    this.last = null;
    this.pending = 0;
  }
}

/** One SpikeFilter per feature field a metric reads. */
export class FeatureSpikeFilter {
  private filters = new Map<keyof MovementFeatures, SpikeFilter>();

  constructor(private readonly thresholdDeg = 45, private readonly confirmFrames = 3) {}

  /** Filters the metric's fields in place on `features`. */
  apply(features: MovementFeatures, metric: MetricSource): void {
    for (const key of featureKeysFor(metric)) {
      let f = this.filters.get(key);
      if (!f) {
        f = new SpikeFilter(this.thresholdDeg, this.confirmFrames);
        this.filters.set(key, f);
      }
      const v = features[key];
      if (typeof v === "number" || v === null) {
        (features as Record<string, unknown>)[key] = f.filter(v as number | null);
      }
    }
  }

  reset(): void {
    this.filters.clear();
  }
}
