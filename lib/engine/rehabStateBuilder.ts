import type { MovementFeatures } from "@/lib/types/movement";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";

export type RehabState = {
  exerciseName: string;
  phase: string;
  repCount: number;
  repTarget: number;

  posture: string;
  isStanding: boolean;
  isSeated: boolean;

  metrics: {
    rightArmElevationDeg?: number | null;
    leftArmElevationDeg?: number | null;
    hipHeightNormalized?: number | null;
    torsoLeanDeg?: number | null;
  };

  issues: string[];
  event: "start" | "phase_change" | "rep_complete" | "rep_failed" | "idle";
};

export function buildRehabState(
  features: MovementFeatures,
  repState: RuntimeRepState,
  prescription: ExercisePrescription,
  event: RehabState["event"]
): RehabState {
  const issues: string[] = [];

  if (
    features.leftArmElevationDeg &&
    features.leftArmElevationDeg > 30 &&
    prescription.id === "RIGHT_ARM_RAISE"
  ) {
    issues.push("left_arm_interference");
  }

  if (features.torsoLeanDeg && features.torsoLeanDeg > 15) {
    issues.push("excessive_lean");
  }

  return {
    exerciseName: prescription.name,
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
    event
  };
}
