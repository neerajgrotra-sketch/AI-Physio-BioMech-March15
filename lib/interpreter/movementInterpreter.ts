import { updateRepState, type RepState } from "@/lib/interpreter/repStateMachine";
import type { MovementFeatures } from "@/lib/types/movement";
import type { CoachingCode } from "@/lib/types/coaching";
import type { ExerciseDefinition } from "@/lib/types/exercise";

export type InterpreterOutput = {
  repState: RepState;
  activeElevationDeg: number | null;
  primaryIssue: CoachingCode;
  isExerciseComplete: boolean;

  holdRemainingMs: number | null;
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

  let holdRemainingMs: number | null = null;

  if (
    repState.phase === "holding" &&
    repState.enteredTopAtMs !== null &&
    exercise.requiresHold
  ) {
    const held = nowMs - repState.enteredTopAtMs;

    holdRemainingMs = Math.max(
      0,
      exercise.holdDurationMs - held
    );
  }

  let primaryIssue: CoachingCode = "idle";

  if (!personDetected) {
    primaryIssue = "person_not_detected";
  }

  else if (repState.justCompletedRep) {
    primaryIssue = "good_rep";
  }

  else if (repState.justCompletedHold) {
    primaryIssue = "hold_complete";
  }

  else if (repState.phase === "lifting") {
    primaryIssue = "lift_higher";
  }

  else if (repState.phase === "top") {
    primaryIssue = "hold_position";
  }

  else if (repState.phase === "holding") {
    primaryIssue = "keep_holding";
  }

  else if (repState.phase === "lowering") {
    primaryIssue = "lower_slowly";
  }

  else if (repState.phase === "ready") {
    primaryIssue = "start_exercise";
  }

  else if (repState.phase === "completed") {
    primaryIssue = "exercise_complete";
  }

  return {
    repState,
    activeElevationDeg,
    primaryIssue,
    isExerciseComplete: repState.phase === "completed",
    holdRemainingMs
  };
}
