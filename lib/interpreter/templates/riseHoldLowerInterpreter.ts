import { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import { MovementFeatures } from "@/lib/types/movement";

export function interpretRiseHoldLower(
  state: RuntimeRepState,
  features: MovementFeatures,
  holdMs: number,
  timestamp: number
) {
  const next = { ...state };

  if (state.phase === "ready") {
    if (!features.isSeated) return next;

    next.phase = "rising";
    return next;
  }

  if (state.phase === "rising") {
    if (features.isStanding) {
      next.phase = "holding";
      next.phaseStartTime = timestamp;
      return next;
    }
  }

  if (state.phase === "holding") {
    const elapsed = timestamp - (state.phaseStartTime ?? timestamp);

    if (elapsed >= holdMs) {
      next.phase = "lowering";
      return next;
    }
  }

  if (state.phase === "lowering") {
    if (features.isSeated) {
      next.repCount += 1;
      next.phase = "ready";
      return next;
    }
  }

  return next;
}
