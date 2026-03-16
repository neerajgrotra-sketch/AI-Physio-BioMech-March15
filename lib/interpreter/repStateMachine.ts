import type { ExerciseDefinition, ExercisePhase } from "@/lib/types/exercise";

export type RepState = {
  phase: ExercisePhase;
  repCount: number;
  justCompletedRep: boolean;

  enteredTopAtMs: number | null;
  holdSatisfied: boolean;
  justEnteredHolding: boolean;
  justCompletedHold: boolean;
};

export function createInitialRepState(): RepState {
  return {
    phase: "ready",
    repCount: 0,
    justCompletedRep: false,
    enteredTopAtMs: null,
    holdSatisfied: false,
    justEnteredHolding: false,
    justCompletedHold: false
  };
}

export function updateRepState(
  currentState: RepState,
  activeElevationDeg: number | null,
  exercise: ExerciseDefinition,
  nowMs: number
): RepState {
  const elevation = activeElevationDeg ?? 0;

  let nextPhase = currentState.phase;
  let nextRepCount = currentState.repCount;
  let justCompletedRep = false;

  let enteredTopAtMs = currentState.enteredTopAtMs;
  let holdSatisfied = currentState.holdSatisfied;
  let justEnteredHolding = false;
  let justCompletedHold = false;

  if (currentState.phase === "completed") {
    return {
      ...currentState,
      justCompletedRep: false,
      justEnteredHolding: false,
      justCompletedHold: false
    };
  }

  switch (currentState.phase) {
    case "ready": {
      if (elevation > exercise.startThresholdDeg) {
        nextPhase = "lifting";
      }
      enteredTopAtMs = null;
      holdSatisfied = false;
      break;
    }

    case "lifting": {
      if (elevation >= exercise.targetThresholdDeg) {
        nextPhase = "top";
        enteredTopAtMs = nowMs;

        if (!exercise.requiresHold || exercise.holdDurationMs <= 0) {
          holdSatisfied = true;
        }
      } else if (elevation < exercise.startThresholdDeg) {
        nextPhase = "ready";
        enteredTopAtMs = null;
        holdSatisfied = false;
      }
      break;
    }

    case "top": {
      if (elevation < exercise.targetThresholdDeg - exercise.topToleranceDeg) {
        nextPhase = "lifting";
        enteredTopAtMs = null;
        holdSatisfied = false;
      } else if (!exercise.requiresHold || exercise.holdDurationMs <= 0) {
        nextPhase = "lowering";
      } else {
        nextPhase = "holding";
        justEnteredHolding = true;
      }
      break;
    }

    case "holding": {
      if (elevation < exercise.targetThresholdDeg - exercise.topToleranceDeg) {
        nextPhase = "lifting";
        enteredTopAtMs = null;
        holdSatisfied = false;
      } else if (enteredTopAtMs !== null) {
        const heldForMs = nowMs - enteredTopAtMs;

        if (!holdSatisfied && heldForMs >= exercise.holdDurationMs) {
          holdSatisfied = true;
          justCompletedHold = true;
        }

        if (holdSatisfied) {
          nextPhase = "lowering";
        }
      }
      break;
    }

    case "lowering": {
      if (elevation <= exercise.finishThresholdDeg) {
        nextRepCount += 1;
        justCompletedRep = true;

        if (nextRepCount >= exercise.repTarget) {
          nextPhase = "completed";
        } else {
          nextPhase = "ready";
        }

        enteredTopAtMs = null;
        holdSatisfied = false;
      }
      break;
    }
  }

  return {
    phase: nextPhase,
    repCount: nextRepCount,
    justCompletedRep,
    enteredTopAtMs,
    holdSatisfied,
    justEnteredHolding,
    justCompletedHold
  };
}
