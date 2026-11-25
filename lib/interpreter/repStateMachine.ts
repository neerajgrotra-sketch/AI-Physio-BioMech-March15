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
    hasDescendedFromPeak: false,
    everReachedTarget: false,

    everViolatedIsolation: false,
    everHadBilateralParticipationGap: false,

    lastRepEvaluation: buildRepEvaluation("none", null)
  };
}

// How long the metric may sit below the hold floor before the hold ends.
export const HOLD_DIP_GRACE_MS = 300;
// A lift that peaks at least this far past the start threshold and comes
// back without reaching the target counts as a failed (too low) rep.
export const SHORT_ATTEMPT_DEG = 15;

export function updateRepState(
  currentState: RuntimeRepState,
  activeMetricValue: number | null,
  prescription: ExercisePrescription,
  nowMs: number,
  balanceOk: boolean,
  isolationOk: boolean,
  bilateralParticipationOk: boolean
): RuntimeRepState {
  // No reading this frame (the joint was not seen, or tracking dropped out):
  // keep the rep exactly where it is. It used to count as 0°, which dropped
  // a hold into "lowering" and failed the rep on a single lost frame.
  if (activeMetricValue === null) {
    return {
      ...currentState,
      justCompletedRep: false,
      justFailedRep: false,
      justCompletedHold: false,
      lastRepEvaluation: buildRepEvaluation("none", null)
    };
  }
  const value = activeMetricValue;

  let phase: MovementPhase = currentState.phase;
  let repCount = currentState.repCount;

  let justCompletedRep = false;
  let justFailedRep = false;
  let justCompletedHold = false;

  let enteredTopAtMs = currentState.enteredTopAtMs;
  let enteredLoweringAtMs = currentState.enteredLoweringAtMs;
  let holdSatisfied = currentState.holdSatisfied;
  let hasDescendedFromPeak = currentState.hasDescendedFromPeak;
  let everReachedTarget = currentState.everReachedTarget;

  let everViolatedIsolation = currentState.everViolatedIsolation;
  let everHadBilateralParticipationGap = currentState.everHadBilateralParticipationGap;

  let lastRepEvaluation: RepEvaluation = buildRepEvaluation("none", null);
  let dipStartedAtMs = currentState.dipStartedAtMs ?? null;
  let attemptPeak = currentState.attemptPeak ?? null;

  if (currentState.phase === "complete") {
    return {
      ...currentState,
      justCompletedRep: false,
      justFailedRep: false,
      justCompletedHold: false,
      lastRepEvaluation: buildRepEvaluation("none", null)
    };
  }

  // Only accumulate quality violations during the active upward phases.
  // Lowering is explicitly excluded — natural arm swing during descent is
  // not a clinically meaningful isolation failure and should not fail the rep.
  const activePhase =
    currentState.phase === "lifting" ||
    currentState.phase === "top" ||
    currentState.phase === "holding";

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
      hasDescendedFromPeak = false;
      everReachedTarget = false;
      everViolatedIsolation = false;
      everHadBilateralParticipationGap = false;
      break;
    }

    case "lifting": {
      attemptPeak = attemptPeak === null ? value : Math.max(attemptPeak, value);
      if (value >= prescription.targetThreshold) {
        phase = "top";
        enteredTopAtMs = nowMs;
        everReachedTarget = true;

        if (!prescription.hold.required || prescription.hold.durationMs <= 0) {
          holdSatisfied = true;
        }
      } else if (value < prescription.startThreshold) {
        // Came back down without reaching the target. A real attempt (it
        // got SHORT_ATTEMPT_DEG past the start) is a failed rep on height;
        // a twitch over the start line is ignored. These used to vanish,
        // so short attempts never reached the session results.
        if (attemptPeak !== null && attemptPeak >= prescription.startThreshold + SHORT_ATTEMPT_DEG) {
          justFailedRep = true;
          lastRepEvaluation =
            prescription.side === "both" && everHadBilateralParticipationGap
              ? buildRepEvaluation("failed", "failed_bilateral_participation")
              : buildRepEvaluation("failed", "failed_height");
        }
        phase = "ready";
        enteredTopAtMs = null;
        holdSatisfied = false;
        hasDescendedFromPeak = false;
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
        // A brief wobble below the hold floor is forgiven; only a dip that
        // lasts HOLD_DIP_GRACE_MS ends the hold.
        if (dipStartedAtMs === null) dipStartedAtMs = nowMs;
        if (nowMs - dipStartedAtMs >= HOLD_DIP_GRACE_MS) {
          phase = "lowering";
          enteredLoweringAtMs = nowMs;
          dipStartedAtMs = null;
        }
      } else if (enteredTopAtMs !== null) {
        dipStartedAtMs = null;
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
      const loweringTolerance = prescription.target.tolerance ?? 0;

      // Track when the metric first meaningfully drops below target during lowering.
      // This is the only reliable signal that the patient has actually started lowering.
      if (!hasDescendedFromPeak && value < prescription.targetThreshold - loweringTolerance) {
        hasDescendedFromPeak = true;
      }

      // Re-raise escape: patient lifted back up during lowering phase.
      // Only fires AFTER they have genuinely started descending (hasDescendedFromPeak).
      // This prevents phantom re-triggers on the frame immediately after hold completes
      // when the patient is still at peak height.
      if (
        holdSatisfied &&
        hasDescendedFromPeak &&
        value >= prescription.targetThreshold - loweringTolerance
      ) {
        phase = "holding";
        enteredTopAtMs = nowMs;
        enteredLoweringAtMs = null;
        hasDescendedFromPeak = false;
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
        hasDescendedFromPeak = false;
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
    hasDescendedFromPeak,
    everReachedTarget,

    everViolatedIsolation,
    everHadBilateralParticipationGap,

    dipStartedAtMs: phase === "holding" ? dipStartedAtMs : null,
    attemptPeak: phase === "lifting" ? attemptPeak : null,

    lastRepEvaluation
  };
}
