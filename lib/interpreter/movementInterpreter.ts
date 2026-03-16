import { updateRepState } from "@/lib/interpreter/repStateMachine";
import type { MovementFeatures } from "@/lib/types/movement";
import type { CoachingCode } from "@/lib/types/coaching";
import type { ExercisePrescription, MetricSource } from "@/lib/types/exercise";
import type {
  RuntimeEvaluationResult,
  RuntimeFrameContext,
  RuntimeRepState
} from "@/lib/engine/runtimeTypes";

export type InterpreterOutput = RuntimeEvaluationResult & {
  primaryIssue: CoachingCode;
};

function getMetricValue(
  features: MovementFeatures,
  metric: MetricSource
): number | null {
  switch (metric) {
    case "rightArmElevationDeg":
      return features.rightArmElevationDeg;
    case "leftArmElevationDeg":
      return features.leftArmElevationDeg;
    case "bilateralArmElevationDeg":
      return features.bilateralArmElevationDeg;
    case "rightElbowAngleDeg":
      return features.rightElbowAngleDeg;
    case "leftElbowAngleDeg":
      return features.leftElbowAngleDeg;
    case "torsoLeanDeg":
      return features.torsoLeanDeg;
    case "shoulderTiltDeg":
      return features.shoulderTiltDeg;
    case "rightWristToShoulderDy":
      return features.rightWristToShoulderDy;
    case "leftWristToShoulderDy":
      return features.leftWristToShoulderDy;
    default:
      return null;
  }
}

function getEffectiveActiveMetricValue(
  features: MovementFeatures,
  prescription: ExercisePrescription
): number | null {
  if (
    prescription.side === "both" &&
    prescription.target.metric === "bilateralArmElevationDeg"
  ) {
    const left = features.leftArmElevationDeg;
    const right = features.rightArmElevationDeg;

    if (left === null || right === null) return null;

    return Math.min(left, right);
  }

  return getMetricValue(features, prescription.target.metric);
}

function getIsolationOk(
  features: MovementFeatures,
  prescription: ExercisePrescription
): boolean {
  const limit = prescription.qualityLimits?.maxOppositeArmElevationDeg;

  if (limit === undefined) return true;

  if (prescription.side === "right") {
    const opposite = features.leftArmElevationDeg;
    return opposite === null || opposite <= limit;
  }

  if (prescription.side === "left") {
    const opposite = features.rightArmElevationDeg;
    return opposite === null || opposite <= limit;
  }

  return true;
}

export function interpretMovement(
  currentRepState: RuntimeRepState,
  features: MovementFeatures,
  prescription: ExercisePrescription,
  frameContext: RuntimeFrameContext
): InterpreterOutput {
  const activeMetricValue = getEffectiveActiveMetricValue(features, prescription);

  const maxTorsoLeanDeg = prescription.qualityLimits?.maxTorsoLeanDeg;
  const balanceOk =
    maxTorsoLeanDeg === undefined ||
    features.torsoLeanDeg === null ||
    features.torsoLeanDeg <= maxTorsoLeanDeg;

  const isolationOk = getIsolationOk(features, prescription);

  const repState = updateRepState(
    currentRepState,
    activeMetricValue,
    prescription,
    frameContext.timestampMs,
    balanceOk,
    isolationOk
  );

  let holdRemainingMs: number | null = null;

  if (
    repState.phase === "holding" &&
    repState.enteredTopAtMs !== null &&
    prescription.hold.required
  ) {
    const held = frameContext.timestampMs - repState.enteredTopAtMs;
    holdRemainingMs = Math.max(0, prescription.hold.durationMs - held);
  }

  let primaryIssue: CoachingCode = "idle";

  if (!frameContext.personDetected) {
    primaryIssue = "person_not_detected";
  } else if (repState.phase === "complete") {
    primaryIssue = "exercise_complete";
  } else if (repState.justCompletedRep) {
    primaryIssue = "good_rep";
  } else if (repState.justFailedRep) {
    if (repState.lastRepEvaluation.reason === "failed_hold") {
      primaryIssue = "rep_failed_hold";
    } else if (repState.lastRepEvaluation.reason === "failed_height") {
      primaryIssue = "rep_failed_height";
    } else if (repState.lastRepEvaluation.reason === "failed_balance") {
      primaryIssue = "rep_failed_balance";
    } else if (repState.lastRepEvaluation.reason === "failed_isolation") {
      primaryIssue = "rep_failed_isolation";
    }
  } else if (repState.justCompletedHold) {
    primaryIssue = "hold_complete";
  } else if (!balanceOk) {
    primaryIssue = "keep_balanced";
  } else if (
    repState.phase === "lifting" &&
    activeMetricValue !== null &&
    activeMetricValue < prescription.targetThreshold
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
    activeMetricValue,
    holdRemainingMs,
    isComplete: repState.phase === "complete",
    primaryIssue
  };
}
