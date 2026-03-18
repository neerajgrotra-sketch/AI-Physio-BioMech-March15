import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { MovementFeatures } from "@/lib/types/movement";

export function interpretRiseHoldLower(
  state: RuntimeRepState,
  features: MovementFeatures,
  holdMs: number,
  timestamp: number
): RuntimeRepState {
  const next: RuntimeRepState = {
    ...state,
    justCompletedRep: false,
    justFailedRep: false,
    justCompletedHold: false,
    lastRepEvaluation: { outcome: "none", reason: null }
  };

  if (next.phase === "complete") {
    return next;
  }

  if (next.phase === "idle" || next.phase === "ready") {
    if (features.isSeated) {
      next.phase = "lifting";
    }
    return next;
  }

  if (next.phase === "lifting") {
    if (features.isStanding) {
      next.phase = "holding";
      next.enteredTopAtMs = timestamp;
      next.everReachedTarget = true;
    }
    return next;
  }

  if (next.phase === "holding") {
    const enteredAt = next.enteredTopAtMs ?? timestamp;
    const elapsed = timestamp - enteredAt;

    if (elapsed >= holdMs) {
      next.holdSatisfied = true;
      next.justCompletedHold = true;
      next.phase = "lowering";
    }

    return next;
  }

  if (next.phase === "lowering") {
    if (features.isSeated) {
      if (!next.everReachedTarget) {
        next.justFailedRep = true;
        next.lastRepEvaluation = {
          outcome: "failed",
          reason: "failed_height"
        };
      } else if (!next.holdSatisfied) {
        next.justFailedRep = true;
        next.lastRepEvaluation = {
          outcome: "failed",
          reason: "failed_hold"
        };
      } else {
        next.repCount += 1;
        next.justCompletedRep = true;
        next.lastRepEvaluation = {
          outcome: "success",
          reason: null
        };
      }

      next.phase = "ready";
      next.enteredTopAtMs = null;
      next.holdSatisfied = false;
      next.everReachedTarget = false;

      if (next.repCount >= 5) {
        next.phase = "complete";
      }
    }

    return next;
  }

  return next;
}
