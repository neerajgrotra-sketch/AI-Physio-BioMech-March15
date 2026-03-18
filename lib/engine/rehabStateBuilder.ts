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
    hipHeightNormalized: number | null;
    torsoLeanDeg: number | null;
  };

  issues: string[];
  failureReason: string | null;
  event: RehabEvent;
};

export function buildRehabState(
  features: MovementFeatures,
  repState: RuntimeRepState,
  prescription: ExercisePrescription,
  event: RehabEvent
): RehabState {
  const issues: string[] = [];

  if (
    prescription.side === "right" &&
    features.leftArmElevationDeg !== null &&
    features.leftArmElevationDeg > 30
  ) {
    issues.push("left_arm_interference");
  }

  if (
    prescription.side === "left" &&
    features.rightArmElevationDeg !== null &&
    features.rightArmElevationDeg > 30
  ) {
    issues.push("right_arm_interference");
  }

  if (
    prescription.side === "both" &&
    features.rightArmElevationDeg !== null &&
    features.leftArmElevationDeg !== null
  ) {
    const diff = Math.abs(
      features.rightArmElevationDeg - features.leftArmElevationDeg
    );
    if (diff > 20) {
      issues.push("bilateral_asymmetry");
    }
  }

  if (features.torsoLeanDeg !== null && features.torsoLeanDeg > 15) {
    issues.push("excessive_lean");
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
      hipHeightNormalized: features.hipHeightNormalized,
      torsoLeanDeg: features.torsoLeanDeg
    },

    issues,
    failureReason: repState.lastRepEvaluation.reason,
    event
  };
}
