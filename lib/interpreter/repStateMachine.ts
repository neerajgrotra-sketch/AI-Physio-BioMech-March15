import type { ExerciseDefinition, ExercisePhase } from "@/lib/types/exercise";

export type RepFailureReason =
  | "failed_hold"
  | "failed_height"
  | "failed_balance"
  | null;

export type RepState = {
  phase: ExercisePhase;
  repCount: number;
  justCompletedRep: boolean;

  enteredTopAtMs: number | null;
  holdSatisfied: boolean;
  everReachedTarget: boolean;
  justEnteredHolding: boolean;
  justCompletedHold: boolean;

  lastRepFailureReason: RepFailureReason;
  justFailedRep: boolean;
};

export function createInitialRepState(): RepState {
  return {
    phase: "ready",
    repCount: 0,
    justCompletedRep: false,

    enteredTopAtMs: null,
    holdSatisfied: false,
    everReachedTarget: false,
    justEnteredHolding: false,
    justCompletedHold: false,

    lastRepFailureReason: null,
    justFailedRep: false
  };
}

export function updateRepState(
  currentState: RepState,
  activeElevationDeg: number | null,
  exercise: ExerciseDefinition,
  nowMs: number,
  balanceOk: boolean
): RepState {
  const elevation = activeElevationDeg ?? 0;

  let nextPhase = currentState.phase;
  let nextRepCount = currentState.repCount;
  let justCompletedRep = false;

  let enteredTopAtMs = currentState.enteredTopAtMs;
  let holdSatisfied = currentState.holdSatisfied;
  let everReachedTarget = currentState.everReachedTarget;
  let justEnteredHolding = false;
  let justCompletedHold = false;

  let lastRepFailureReason: RepFailureReason = null;
  let justFailedRep = false;

  if (currentState.phase === "completed") {
    return {
      ...currentState,
      justCompletedRep: false,
      justEnteredHolding: false,
      justCompletedHold: false,
      justFailedRep: false,
      lastRepFailureReason: null
    };
  }

  switch (currentState.phase) {
    case "ready": {
      if (elevation > exercise.startThresholdDeg) {
        nextPhase = "lifting";
      }

      enteredTopAtMs = null;
      holdSatisfied = false;
      everReachedTarget = false;
      break;
    }

    case "lifting": {
      if (elevation >= exercise.targetThresholdDeg) {
        nextPhase = "top";
        enteredTopAtMs = nowMs;
        everReachedTarget = true;

        if (!exercise.requiresHold || exercise.holdDurationMs <= 0) {
          holdSatisfied = true;
        }
      } else if (elevation < exercise.startThresholdDeg) {
        nextPhase = "ready";
        enteredTopAtMs = null;
        holdSatisfied = false;
        everReachedTarget = false;
      }
      break;
    }

    case "top": {
      if (elevation < exercise.targetThresholdDeg - exercise.topToleranceDeg) {
        nextPhase = "lifting";
        enteredTopAtMs = null;
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
        nextPhase = "lowering";
      } else if (enteredTopAtMs !== null) {
        const heldForMs = nowMs - enteredTopAtMs;

        if (!holdSatisfied && heldForMs >= exercise.holdDurationMs) {
          holdSatisfied = true;
          justCompletedHold = true;
          nextPhase = "lowering";
        }
      }
      break;
    }

    case "lowering": {
      if (elevation <= exercise.finishThresholdDeg) {
        if (!everReachedTarget) {
          justFailedRep = true;
          lastRepFailureReason = "failed_height";
        } else if (exercise.requiresHold && !holdSatisfied) {
          justFailedRep = true;
          lastRepFailureReason = "failed_hold";
        } else if (!balanceOk) {
          justFailedRep = true;
          lastRepFailureReason = "failed_balance";
        } else {
          nextRepCount += 1;
          justCompletedRep = true;
        }

        if (nextRepCount >= exercise.repTarget) {
          nextPhase = "completed";
        } else {
          nextPhase = "ready";
        }

        enteredTopAtMs = null;
        holdSatisfied = false;
        everReachedTarget = false;
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
    everReachedTarget,
    justEnteredHolding,
    justCompletedHold,

    lastRepFailureReason,
    justFailedRep
  };
}
