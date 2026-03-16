import { updateRepState, type RepState } from "@/lib/interpreter/repStateMachine";
import type { MovementFeatures } from "@/lib/types/movement";
import type { CoachingCode } from "@/lib/types/coaching";
import type { ExerciseDefinition } from "@/lib/types/exercise";

export type InterpreterOutput = {
  repState: RepState;
  activeElevationDeg: number | null;
  primaryIssue: CoachingCode;
  isExerciseComplete: boolean;
};

function getActiveElevation(
  features: MovementFeatures,
  exercise: ExerciseDefinition
): number | null {
  if (exercise.primarySide === "right") return features.rightArmElevationDeg;
  if (exercise.primarySide === "left") return features.leftArmElevationDeg;
  return features.bilateralArmElevationDeg;
}

export function interpretMovement(
  currentRepState: RepState,
  features: MovementFeatures,
  exercise: ExerciseDefinition,
  personDetected: boolean
): InterpreterOutput {
  const activeElevationDeg = getActiveElevation(features, exercise);
  const repState = updateRepState(currentRepState, activeElevationDeg, exercise);

  let primaryIssue: CoachingCode = "idle";

  if (!personDetected) {
    primaryIssue = "person_not_detected";
  } else if (repState.phase === "completed") {
    primaryIssue = "exercise_complete";
  } else if (repState.justCompletedRep) {
    primaryIssue = "good_rep";
  } else if (
    features.torsoLeanDeg !== null &&
    features.torsoLeanDeg > 18
  ) {
    primaryIssue = "keep_balanced";
  } else if (
    repState.phase === "lifting" &&
    activeElevationDeg !== null &&
    activeElevationDeg < exercise.targetThresholdDeg - 15
  ) {
    primaryIssue = "lift_higher";
  } else if (repState.phase === "lowering") {
    primaryIssue = "lower_slowly";
  } else if (repState.phase === "ready") {
    primaryIssue = "start_exercise";
  }

  return {
    repState,
    activeElevationDeg,
    primaryIssue,
    isExerciseComplete: repState.phase === "completed"
  };
}
