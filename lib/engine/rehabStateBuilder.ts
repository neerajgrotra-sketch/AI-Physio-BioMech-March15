import type { MovementFeatures } from "@/lib/types/movement";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";

export type RehabEvent =
  | "start"
  | "phase_change"
  | "rep_complete"
  | "rep_failed"
  | "exercise_complete"
  | "idle";

export type RehabState = {
  exerciseId: string;
  exerciseName: string;
  template: string;
  side: string;

  phase: string;
  repCount: number;
  repTarget: number;

  posture: string;
  isStanding: boolean;
  isSeated: boolean;

  metrics: {
    rightArmElevationDeg: number | null;
    leftArmElevationDeg: number | null;
    bilateralArmElevationDeg: number | null;
    hipHeightNormalized: number | null;
    torsoLeanDeg: number | null;
    shoulderTiltDeg: number | null;
  };

  evaluation: {
    reachedTarget: boolean;
    holdSatisfied: boolean;
  };

  detectedIssues: string[];
  failureReason: string | null;
  event: RehabEvent;
};

export function buildRehabState(
  features: MovementFeatures,
  repState: RuntimeRepState,
  prescription: ExercisePrescription,
  event: RehabEvent
): RehabState {
  const detectedIssues: string[] = [];

  const targetMetric = prescription.target.metric;
  let activeMetric: number | null = null;

  switch (targetMetric) {
    case "rightArmElevationDeg":
      activeMetric = features.rightArmElevationDeg;
      break;
    case "leftArmElevationDeg":
      activeMetric = features.leftArmElevationDeg;
      break;
    case "bilateralArmElevationDeg":
      if (
        features.rightArmElevationDeg !== null &&
        features.leftArmElevationDeg !== null
      ) {
        activeMetric = Math.min(
          features.rightArmElevationDeg,
          features.leftArmElevationDeg
        );
      }
      break;
    case "hipHeightNormalized":
      activeMetric = features.hipHeightNormalized;
      break;
    default:
      activeMetric = null;
  }

  if (
    activeMetric !== null &&
    activeMetric < prescription.target.targetValue - prescription.target.tolerance
  ) {
    detectedIssues.push("insufficient_range");
  }

  if (
    prescription.side === "right" &&
    features.leftArmElevationDeg !== null &&
    features.leftArmElevationDeg > 30
  ) {
    detectedIssues.push("opposite_arm_interference");
  }

  if (
    prescription.side === "left" &&
    features.rightArmElevationDeg !== null &&
    features.rightArmElevationDeg > 30
  ) {
    detectedIssues.push("opposite_arm_interference");
  }

  if (
    prescription.side === "both" &&
    features.rightArmElevationDeg !== null &&
    features.leftArmElevationDeg !== null &&
    Math.abs(features.rightArmElevationDeg - features.leftArmElevationDeg) > 20
  ) {
    detectedIssues.push("bilateral_asymmetry");
  }

  if (
    features.torsoLeanDeg !== null &&
    prescription.qualityLimits?.maxTorsoLeanDeg !== undefined &&
    features.torsoLeanDeg > prescription.qualityLimits.maxTorsoLeanDeg
  ) {
    detectedIssues.push("excessive_torso_lean");
  }

  if (
    features.shoulderTiltDeg !== null &&
    prescription.qualityLimits?.maxShoulderTiltDeg !== undefined &&
    features.shoulderTiltDeg > prescription.qualityLimits.maxShoulderTiltDeg
  ) {
    detectedIssues.push("shoulder_tilt");
  }

  return {
    exerciseId: prescription.id,
    exerciseName: prescription.name,
    template: prescription.template,
    side: prescription.side,

    phase: repState.phase,
    repCount: repState.repCount,
    repTarget: prescription.repTarget,

    posture: features.posture,
    isStanding: features.isStanding,
    isSeated: features.isSeated,

    metrics: {
      rightArmElevationDeg: features.rightArmElevationDeg,
      leftArmElevationDeg: features.leftArmElevationDeg,
      bilateralArmElevationDeg: features.bilateralArmElevationDeg,
      hipHeightNormalized: features.hipHeightNormalized,
      torsoLeanDeg: features.torsoLeanDeg,
      shoulderTiltDeg: features.shoulderTiltDeg
    },

    evaluation: {
      reachedTarget: repState.everReachedTarget,
      holdSatisfied: repState.holdSatisfied
    },

    detectedIssues,
    failureReason: repState.lastRepEvaluation.reason,
    event
  };
}
