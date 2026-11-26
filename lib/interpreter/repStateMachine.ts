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

// A rep is judged and counted the moment its hold is done (or the target is
// reached, with no hold): reach the target, hold, rep counted, then lower.
// It used to be counted only once the arm was back at rest below the finish
// threshold, so a patient who came back to a hand-on-desk rest never got
// the rep, and a second raise before reaching rest re-entered a hold that
// could never complete.
//
// While lowering, the next rep starts when the arm is back at rest (below
// finish), or when it has come at least REARM_SHARE of the way down and
// starts rising again by REARM_RISE_DEG (a patient who doesn't rest fully).
export const REARM_SHARE = 0.5;
export const REARM_RISE_DEG = 12;

function judgeRep(
  prescription: ExercisePrescription,
  balanceOk: boolean,
  isolationOk: boolean,
  everViolatedIsolation: boolean,
  everHadBilateralParticipationGap: boolean
): RepEvaluation {
  if (prescription.side === "both" && everHadBilateralParticipationGap) {
    return buildRepEvaluation("failed", "failed_bilateral_participation");
  }
  if (!balanceOk) return buildRepEvaluation("failed", "failed_balance");
  if (!isolationOk || everViolatedIsolation) return buildRepEvaluation("failed", "failed_isolation");
  return buildRepEvaluation("success", null);
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
        // No hold: the rep is done the moment the target is reached.
        lastRepEvaluation = judgeRep(prescription, balanceOk, isolationOk, everViolatedIsolation, everHadBilateralParticipationGap);
        if (lastRepEvaluation.outcome === "success") { repCount += 1; justCompletedRep = true; } else { justFailedRep = true; }
        holdSatisfied = true;
        phase = "lowering";
        enteredLoweringAtMs = nowMs;
        attemptPeak = value;
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
          // Came down before the hold was done: a failed rep, said now.
          justFailedRep = true;
          lastRepEvaluation = buildRepEvaluation("failed", "failed_hold");
          holdSatisfied = true; // judged; don't judge again while lowering
          phase = "lowering";
          enteredLoweringAtMs = nowMs;
          dipStartedAtMs = null;
          attemptPeak = value;
        }
      } else if (enteredTopAtMs !== null) {
        dipStartedAtMs = null;
        const heldForMs = nowMs - enteredTopAtMs;

        if (!holdSatisfied && heldForMs >= prescription.hold.durationMs) {
          holdSatisfied = true;
          justCompletedHold = true;
          lastRepEvaluation = judgeRep(prescription, balanceOk, isolationOk, everViolatedIsolation, everHadBilateralParticipationGap);
          if (lastRepEvaluation.outcome === "success") { repCount += 1; justCompletedRep = true; } else { justFailedRep = true; }
          phase = "lowering";
          enteredLoweringAtMs = nowMs;
          attemptPeak = value;
        }
      }
      break;
    }

    case "lowering": {
      // The rep was already judged (at hold completion, or when the hold
      // failed). Here we only wait for the arm to come back so the next
      // rep can start. attemptPeak tracks the LOWEST point while lowering.
      const low = attemptPeak === null ? value : Math.min(attemptPeak, value);
      attemptPeak = low;
      const range = prescription.targetThreshold - prescription.finishThreshold;
      const cameDownEnough = low <= prescription.targetThreshold - REARM_SHARE * range;
      const backAtRest = value <= prescription.finishThreshold;
      const risingAgain = cameDownEnough && value >= low + REARM_RISE_DEG;

      if (backAtRest || risingAgain) {
        if (repCount >= prescription.repTarget) {
          phase = "complete";
        } else {
          phase = risingAgain && !backAtRest ? "lifting" : "ready";
        }
        attemptPeak = phase === "lifting" ? value : null;
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
    attemptPeak: phase === "lifting" || phase === "lowering" ? attemptPeak : null,

    lastRepEvaluation
  };
}
