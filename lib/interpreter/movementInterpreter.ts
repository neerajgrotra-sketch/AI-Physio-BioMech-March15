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

function buildResult(
  repState: RuntimeRepState,
  activeMetricValue: number | null,
  holdRemainingMs: number | null,
  primaryIssue: CoachingCode
): InterpreterOutput {
  return {
    repState,
    activeMetricValue,
    holdRemainingMs,
    isComplete: repState.phase === "complete",
    primaryIssue
  };
}

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
    case "hipCenterY":
      return features.hipCenterY;
    case "hipCenterVelocityY":
      return features.hipVelocityY;
    case "kneeToHipExtensionScore": {
      const left = features.kneeAngleLeft;
      const right = features.kneeAngleRight;

      if (left === null && right === null) return null;
      if (left === null) return right;
      if (right === null) return left;

      return (left + right) / 2;
    }
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

    // Both sides must contribute for bilateral raises.
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

function getBilateralParticipationOk(
  features: MovementFeatures,
  prescription: ExercisePrescription
): boolean {
  if (prescription.side !== "both") return true;

  const left = features.leftArmElevationDeg;
  const right = features.rightArmElevationDeg;

  if (left === null || right === null) return false;

  const participationThreshold = prescription.startThreshold;
  const leftActive = left > participationThreshold;
  const rightActive = right > participationThreshold;

  return leftActive && rightActive;
}

function getRaiseLowerPrimaryIssue(
  repState: RuntimeRepState,
  personDetected: boolean,
  balanceOk: boolean,
  isolationOk: boolean,
  bilateralParticipationOk: boolean,
  prescription: ExercisePrescription,
  activeMetricValue: number | null
): CoachingCode {
  const isActivePhase =
    repState.phase === "lifting" ||
    repState.phase === "top" ||
    repState.phase === "holding";

  if (!personDetected) {
    return "person_not_detected";
  }

  if (repState.phase === "complete") {
    return "exercise_complete";
  }

  if (repState.justCompletedRep) {
    return "good_rep";
  }

  if (repState.justFailedRep) {
    if (repState.lastRepEvaluation.reason === "failed_hold") {
      return "rep_failed_hold";
    }
    if (repState.lastRepEvaluation.reason === "failed_height") {
      return "rep_failed_height";
    }
    if (repState.lastRepEvaluation.reason === "failed_balance") {
      return "rep_failed_balance";
    }
    if (repState.lastRepEvaluation.reason === "failed_isolation") {
      return "rep_failed_isolation";
    }
    if (
      repState.lastRepEvaluation.reason === "failed_bilateral_participation"
    ) {
      return "rep_failed_bilateral_participation";
    }
  }

  if (repState.justCompletedHold) {
    return "hold_complete";
  }

  if (!balanceOk) {
    return "keep_balanced";
  }

  if (isActivePhase && prescription.side !== "both" && !isolationOk) {
    return "wrong_side_participation";
  }

  if (isActivePhase && prescription.side === "both" && !bilateralParticipationOk) {
    return "other_side_not_active";
  }

  if (
    repState.phase === "lifting" &&
    activeMetricValue !== null &&
    activeMetricValue < prescription.targetThreshold
  ) {
    return "lift_higher";
  }

  if (repState.phase === "top") {
    return "hold_position";
  }

  if (repState.phase === "holding") {
    return "keep_holding";
  }

  if (repState.phase === "lowering") {
    return "lower_slowly";
  }

  if (repState.phase === "ready") {
    return "start_exercise";
  }

  return "idle";
}

function interpretRaiseHoldLower(
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
  const bilateralParticipationOk = getBilateralParticipationOk(
    features,
    prescription
  );

  const repState = updateRepState(
    currentRepState,
    activeMetricValue,
    prescription,
    frameContext.timestampMs,
    balanceOk,
    isolationOk,
    bilateralParticipationOk
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

  const primaryIssue = getRaiseLowerPrimaryIssue(
    repState,
    frameContext.personDetected,
    balanceOk,
    isolationOk,
    bilateralParticipationOk,
    prescription,
    activeMetricValue
  );

  return buildResult(repState, activeMetricValue, holdRemainingMs, primaryIssue);
}

function interpretRiseHoldLower(
  currentRepState: RuntimeRepState,
  features: MovementFeatures,
  prescription: ExercisePrescription,
  frameContext: RuntimeFrameContext
): InterpreterOutput {
  const kneeScore = getMetricValue(features, "kneeToHipExtensionScore");
  const activeMetricValue = kneeScore;

  const maxTorsoLeanDeg = prescription.qualityLimits?.maxTorsoLeanDeg;
  const balanceOk =
    maxTorsoLeanDeg === undefined ||
    features.torsoLeanDeg === null ||
    features.torsoLeanDeg <= maxTorsoLeanDeg;

  const repState: RuntimeRepState = {
    ...currentRepState,
    justCompletedRep: false,
    justFailedRep: false,
    justCompletedHold: false,
    lastRepEvaluation: { outcome: "none", reason: null }
  };

  if (!frameContext.personDetected) {
    return buildResult(repState, activeMetricValue, null, "person_not_detected");
  }

  if (repState.phase === "complete") {
    return buildResult(repState, activeMetricValue, null, "exercise_complete");
  }

  if (repState.phase === "ready" || repState.phase === "idle") {
    if (features.isSeated) {
      repState.phase = "lifting";
      return buildResult(repState, activeMetricValue, null, "start_exercise");
    }
    return buildResult(repState, activeMetricValue, null, "start_exercise");
  }

  if (repState.phase === "lifting") {
    if (!balanceOk) {
      return buildResult(repState, activeMetricValue, null, "keep_balanced");
    }

    if (features.isStanding) {
      repState.phase = prescription.hold.required ? "holding" : "lowering";
      repState.enteredTopAtMs = frameContext.timestampMs;
      repState.everReachedTarget = true;

      if (!prescription.hold.required) {
        repState.holdSatisfied = true;
      }

      return buildResult(
        repState,
        activeMetricValue,
        prescription.hold.required ? prescription.hold.durationMs : null,
        prescription.hold.required ? "hold_position" : "lower_slowly"
      );
    }

    return buildResult(repState, activeMetricValue, null, "lift_higher");
  }

  if (repState.phase === "holding") {
    if (!balanceOk) {
      return buildResult(repState, activeMetricValue, null, "keep_balanced");
    }

    const enteredAt = repState.enteredTopAtMs ?? frameContext.timestampMs;
    const heldFor = frameContext.timestampMs - enteredAt;
    const holdRemainingMs = Math.max(0, prescription.hold.durationMs - heldFor);

    if (holdRemainingMs <= 0) {
      repState.holdSatisfied = true;
      repState.justCompletedHold = true;
      repState.phase = "lowering";
      return buildResult(repState, activeMetricValue, 0, "hold_complete");
    }

    return buildResult(repState, activeMetricValue, holdRemainingMs, "keep_holding");
  }

  if (repState.phase === "lowering") {
    if (features.isSeated) {
      if (!repState.everReachedTarget) {
        repState.justFailedRep = true;
        repState.lastRepEvaluation = {
          outcome: "failed",
          reason: "failed_height"
        };
        repState.phase = "ready";
        repState.enteredTopAtMs = null;
        repState.holdSatisfied = false;
        repState.everReachedTarget = false;
        return buildResult(repState, activeMetricValue, null, "rep_failed_height");
      }

      if (prescription.hold.required && !repState.holdSatisfied) {
        repState.justFailedRep = true;
        repState.lastRepEvaluation = {
          outcome: "failed",
          reason: "failed_hold"
        };
        repState.phase = "ready";
        repState.enteredTopAtMs = null;
        repState.holdSatisfied = false;
        repState.everReachedTarget = false;
        return buildResult(repState, activeMetricValue, null, "rep_failed_hold");
      }

      if (!balanceOk) {
        repState.justFailedRep = true;
        repState.lastRepEvaluation = {
          outcome: "failed",
          reason: "failed_balance"
        };
        repState.phase = "ready";
        repState.enteredTopAtMs = null;
        repState.holdSatisfied = false;
        repState.everReachedTarget = false;
        return buildResult(repState, activeMetricValue, null, "rep_failed_balance");
      }

      repState.repCount += 1;
      repState.justCompletedRep = true;
      repState.lastRepEvaluation = { outcome: "success", reason: null };
      repState.phase =
        repState.repCount >= prescription.repTarget ? "complete" : "ready";
      repState.enteredTopAtMs = null;
      repState.holdSatisfied = false;
      repState.everReachedTarget = false;

      return buildResult(
        repState,
        activeMetricValue,
        null,
        repState.phase === "complete" ? "exercise_complete" : "good_rep"
      );
    }

    return buildResult(repState, activeMetricValue, null, "lower_slowly");
  }

  return buildResult(repState, activeMetricValue, null, "idle");
}

export function interpretMovement(
  currentRepState: RuntimeRepState,
  features: MovementFeatures,
  prescription: ExercisePrescription,
  frameContext: RuntimeFrameContext
): InterpreterOutput {
  switch (prescription.template) {
    case "rise_hold_lower":
      return interpretRiseHoldLower(
        currentRepState,
        features,
        prescription,
        frameContext
      );

    case "raise_hold_lower":
    default:
      return interpretRaiseHoldLower(
        currentRepState,
        features,
        prescription,
        frameContext
      );
  }
}
