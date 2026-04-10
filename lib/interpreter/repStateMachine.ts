import type { MovementPhase, ExercisePrescription } from "@/lib/types/exercise";
import type { RepEvaluation, RuntimeRepState } from "@/lib/engine/runtimeTypes";

function buildRepEvaluation(
  outcome: RepEvaluation["outcome"],
  reason: RepEvaluation["reason"]
): RepEvaluation {
  return { outcome, reason };
}

export function createInitialRepState(): RuntimeRepState {
  return {
    phase: "ready",
    repCount: 0,

    justCompletedRep: false,
    justFailedRep: false,
    justCompletedHold: false,

    enteredTopAtMs: null,
    enteredLoweringAtMs: null,
    holdSatisfied: false,
    everReachedTarget: false,

    everViolatedIsolation: false,
    everHadBilateralParticipationGap: false,

    lastRepEvaluation: buildRepEvaluation("none", null)
  };
}

export function updateRepState(
  currentState: RuntimeRepState,
  activeMetricValue: number | null,
  prescription: ExercisePrescription,
  nowMs: number,
  balanceOk: boolean,
  isolationOk: boolean,
  bilateralParticipationOk: boolean
): RuntimeRepState {
  const value = activeMetricValue ?? 0;

  let phase: MovementPhase = currentState.phase;
  let repCount = currentState.repCount;

  let justCompletedRep = false;
  let justFailedRep = false;
  let justCompletedHold = false;

  let enteredTopAtMs = currentState.enteredTopAtMs;
  let enteredLoweringAtMs = currentState.enteredLoweringAtMs;
  let holdSatisfied = currentState.holdSatisfied;
  let everReachedTarget = currentState.everReachedTarget;

  let everViolatedIsolation = currentState.everViolatedIsolation;
  let everHadBilateralParticipationGap = currentState.everHadBilateralParticipationGap;

  let lastRepEvaluation: RepEvaluation = buildRepEvaluation("none", null);

  if (currentState.phase === "complete") {
    return {
      ...currentState,
      justCompletedRep: false,
      justFailedRep: false,
      justCompletedHold: false,
      lastRepEvaluation: buildRepEvaluation("none", null)
    };
  }

  const activePhase =
    currentState.phase === "lifting" ||
    currentState.phase === "top" ||
    currentState.phase === "holding" ||
    currentState.phase === "lowering";

  if (activePhase) {
    if (!isolationOk) {
      everViolatedIsolation = true;
    }

    if (!bilateralParticipationOk) {
      everHadBilateralParticipationGap = true;
    }
  }

  switch (currentState.phase) {
    case "idle":
    case "ready": {
      if (value > prescription.startThreshold) {
        phase = "lifting";
      }

      enteredTopAtMs = null;
      enteredLoweringAtMs = null;
      holdSatisfied = false;
      everReachedTarget = false;
      everViolatedIsolation = false;
      everHadBilateralParticipationGap = false;
      break;
    }

    case "lifting": {
      if (value >= prescription.targetThreshold) {
        phase = "top";
        enteredTopAtMs = nowMs;
        everReachedTarget = true;

        if (!prescription.hold.required || prescription.hold.durationMs <= 0) {
          holdSatisfied = true;
        }
      } else if (value < prescription.startThreshold) {
        phase = "ready";
        enteredTopAtMs = null;
        holdSatisfied = false;
        everReachedTarget = false;
        everViolatedIsolation = false;
        everHadBilateralParticipationGap = false;
      }
      break;
    }

    case "top": {
      const tolerance = prescription.target.tolerance ?? 0;

      if (value < prescription.targetThreshold - tolerance) {
        phase = "lifting";
        enteredTopAtMs = null;
      } else if (!prescription.hold.required || prescription.hold.durationMs <= 0) {
        phase = "lowering";
      } else {
        phase = "holding";
      }
      break;
    }

    case "holding": {
      const tolerance = prescription.target.tolerance ?? 0;

      if (value < prescription.targetThreshold - tolerance) {
        phase = "lowering";
        enteredLoweringAtMs = nowMs;
      } else if (enteredTopAtMs !== null) {
        const heldForMs = nowMs - enteredTopAtMs;

        if (!holdSatisfied && heldForMs >= prescription.hold.durationMs) {
          holdSatisfied = true;
          justCompletedHold = true;
          phase = "lowering";
          enteredLoweringAtMs = nowMs;
        }
      }
      break;
    }

    case "lowering": {
      // Re-raise escape: patient lifted back up during lowering phase.
      // Gate: only check after 500ms in LOWERING to avoid immediate
      // re-trigger on the frame where hold completes (patient still at peak).
      const loweringTolerance = prescription.target.tolerance ?? 0;
      const msInLowering = enteredLoweringAtMs !== null ? nowMs - enteredLoweringAtMs : 0;
      if (
        holdSatisfied &&
        msInLowering > 500 &&
        value >= prescription.targetThreshold - loweringTolerance
      ) {
        phase = "holding";
        enteredTopAtMs = nowMs;
        enteredLoweringAtMs = null;
        break;
      }

      if (value <= prescription.finishThreshold) {
        if (!everReachedTarget) {
          if (prescription.side === "both" && everHadBilateralParticipationGap) {
            justFailedRep = true;
            lastRepEvaluation = buildRepEvaluation(
              "failed",
              "failed_bilateral_participation"
            );
          } else {
            justFailedRep = true;
            lastRepEvaluation = buildRepEvaluation("failed", "failed_height");
          }
        } else if (prescription.hold.required && !holdSatisfied) {
          justFailedRep = true;
          lastRepEvaluation = buildRepEvaluation("failed", "failed_hold");
        } else if (!balanceOk) {
          justFailedRep = true;
          lastRepEvaluation = buildRepEvaluation("failed", "failed_balance");
        } else if (!isolationOk || everViolatedIsolation) {
          justFailedRep = true;
          lastRepEvaluation = buildRepEvaluation("failed", "failed_isolation");
        } else {
          repCount += 1;
          justCompletedRep = true;
          lastRepEvaluation = buildRepEvaluation("success", null);
        }

        if (repCount >= prescription.repTarget) {
          phase = "complete";
        } else {
          phase = "ready";
        }

        enteredTopAtMs = null;
        enteredLoweringAtMs = null;
        holdSatisfied = false;
        everReachedTarget = false;
        everViolatedIsolation = false;
        everHadBilateralParticipationGap = false;
      }
      break;
    }

    case "bottom": {
      break;
    }
  }

  return {
    phase,
    repCount,

    justCompletedRep,
    justFailedRep,
    justCompletedHold,

    enteredTopAtMs,
    enteredLoweringAtMs,
    holdSatisfied,
    everReachedTarget,

    everViolatedIsolation,
    everHadBilateralParticipationGap,

    lastRepEvaluation
  };
}
