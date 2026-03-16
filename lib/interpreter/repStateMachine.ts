import type { ExerciseDefinition, ExercisePhase } from "@/lib/types/exercise";

export type RepState = {
  phase: ExercisePhase;
  repCount: number;
  justCompletedRep: boolean;
};

export function createInitialRepState(): RepState {
  return {
    phase: "ready",
    repCount: 0,
    justCompletedRep: false
  };
}

export function updateRepState(
  currentState: RepState,
  activeElevationDeg: number | null,
  exercise: ExerciseDefinition
): RepState {
  const elevation = activeElevationDeg ?? 0;

  let nextPhase = currentState.phase;
  let nextRepCount = currentState.repCount;
  let justCompletedRep = false;

  if (currentState.phase === "completed") {
    return currentState;
  }

  switch (currentState.phase) {
    case "ready":
      if (elevation > exercise.startThresholdDeg) {
        nextPhase = "lifting";
      }
      break;

    case "lifting":
      if (elevation >= exercise.targetThresholdDeg) {
        nextPhase = "top";
      } else if (elevation < exercise.startThresholdDeg) {
        nextPhase = "ready";
      }
      break;

    case "top":
      if (elevation < exercise.targetThresholdDeg - 8) {
        nextPhase = "lowering";
      }
      break;

    case "lowering":
      if (elevation <= exercise.finishThresholdDeg) {
        nextRepCount += 1;
        justCompletedRep = true;

        if (nextRepCount >= exercise.repTarget) {
          nextPhase = "completed";
        } else {
          nextPhase = "ready";
        }
      }
      break;
  }

  return {
    phase: nextPhase,
    repCount: nextRepCount,
    justCompletedRep
  };
}
