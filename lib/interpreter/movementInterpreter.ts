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
  personDetected: boolean,
  nowMs: number
): InterpreterOutput {
  const activeElevationDeg = getActiveElevation(features, exercise);

  const repState = updateRepState(
    currentRepState,
    activeElevationDeg,
    exercise,
    nowMs
  );

  let primaryIssue: CoachingCode = "idle";

  if (!personDetected) {
    primaryIssue = "person_not_detected";
  } else if (repState.phase === "completed") {
    primaryIssue = "exercise_complete";
  } else if (repState.justCompletedRep) {
    primaryIssue = "good_rep";
  } else if (repState.justCompletedHold) {
    primaryIssue = "hold_complete";
  } else if (
    features.torsoLeanDeg !== null &&
    features.torsoLeanDeg > 18
  ) {
    primaryIssue = "keep_balanced";
  } else if (
    repState.phase === "lifting" &&
    activeElevationDeg !== null &&
    activeElevationDeg < exercise.targetThresholdDeg
  ) {
    primaryIssue = "lift_higher";
  } else if (repState.phase === "top") {
    primaryIssue = "hold_position";
  } else if (repState.phase === "holding") {
    primaryIssue = "keep_holding";
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
