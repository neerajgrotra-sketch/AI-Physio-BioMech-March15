import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RehabEvent } from "@/lib/engine/rehabStateBuilder";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";

type GuidanceParams = {
  event: RehabEvent;
  prescription: ExercisePrescription;
  repState: RuntimeRepState;
  holdRemainingMs: number | null;
  previousPhase: string;
  currentPhase: string;
  primaryIssue?: string | null;
  detectedIssues?: string[];
};

function hasIssue(detectedIssues: string[] | undefined, issue: string): boolean {
  return Array.isArray(detectedIssues) && detectedIssues.includes(issue);
}

function getExerciseCompleteCue(prescription: ExercisePrescription): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "Right arm raises complete. Well done.";
    case "left-arm-raise":
      return "Left arm raises complete. Well done.";
    case "both-arm-raise":
      return "Both arm raises complete. Well done.";
    case "sit-to-stand":
      return "Sit to stand complete. Well done.";
    default:
      return `${prescription.name} complete. Well done.`;
  }
}

function buildExerciseIntro(prescription: ExercisePrescription): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "We are starting right arm raises. Lift your right arm to shoulder height, hold, then lower slowly.";
    case "left-arm-raise":
      return "We are starting left arm raises. Lift your left arm to shoulder height, hold, then lower slowly.";
    case "both-arm-raise":
      return "We are starting both arm raises. Lift both arms evenly to shoulder height, hold, then lower slowly.";
    case "sit-to-stand":
      return "We are starting sit to stand. Stand up fully, pause, then sit down slowly.";
    default:
      return `${prescription.name}. Move slowly and with control.`;
  }
}

function buildGenericContinuation(prescription: ExercisePrescription): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "Continue with the right arm raise. Lift slowly to shoulder height.";
    case "left-arm-raise":
      return "Continue with the left arm raise. Lift slowly to shoulder height.";
    case "both-arm-raise":
      return "Continue. Lift both arms together slowly and evenly.";
    case "sit-to-stand":
      return "Continue. Stand tall, then lower back down slowly.";
    default:
      return "Continue the next repetition slowly and with control.";
  }
}

function buildIssueSpecificCorrection(
  prescription: ExercisePrescription,
  primaryIssue?: string | null,
  detectedIssues?: string[]
): string | null {
  const issues = detectedIssues ?? [];

  if (primaryIssue === "insufficient_range" || hasIssue(issues, "insufficient_range")) {
    switch (prescription.id) {
      case "right-arm-raise":
        return "Lift your right arm a little higher this time.";
      case "left-arm-raise":
        return "Lift your left arm a little higher this time.";
      case "both-arm-raise":
        return "Lift both arms a little higher together.";
      case "sit-to-stand":
        return "Stand all the way up before lowering.";
      default:
        return "Go a little farther on this next repetition.";
    }
  }

  if (primaryIssue === "shoulder_tilt" || hasIssue(issues, "shoulder_tilt")) {
    switch (prescription.id) {
      case "both-arm-raise":
        return "Keep both shoulders level as you lift.";
      default:
        return "Stay tall and keep your shoulders level.";
    }
  }

  if (primaryIssue === "balance_loss" || hasIssue(issues, "balance_loss")) {
    return "Stay steady and keep your body upright.";
  }

  if (
    primaryIssue === "bilateral_participation_gap" ||
    hasIssue(issues, "bilateral_participation_gap")
  ) {
    return "Lift both arms together and keep them even.";
  }

  if (primaryIssue === "too_fast" || hasIssue(issues, "too_fast")) {
    return "Slow the movement down and stay in control.";
  }

  if (primaryIssue === "wrong_side" || hasIssue(issues, "wrong_side")) {
    switch (prescription.id) {
      case "right-arm-raise":
        return "Use your right arm for this movement.";
      case "left-arm-raise":
        return "Use your left arm for this movement.";
      default:
        return "Use the instructed side for this movement.";
    }
  }

  return null;
}

function buildRepSuccessGuidance(
  prescription: ExercisePrescription,
  repCount: number,
  repTarget: number,
  primaryIssue?: string | null,
  detectedIssues?: string[]
): string {
  const remaining = Math.max(0, repTarget - repCount);

  if (remaining <= 0) {
    return getExerciseCompleteCue(prescription);
  }

  const issueCue = buildIssueSpecificCorrection(
    prescription,
    primaryIssue,
    detectedIssues
  );

  if (issueCue) {
    switch (prescription.id) {
      case "right-arm-raise":
      case "left-arm-raise":
      case "both-arm-raise":
        return `Good. ${issueCue}`;
      case "sit-to-stand":
        return `Good. ${issueCue}`;
      default:
        return `Good. ${issueCue}`;
    }
  }

  switch (prescription.id) {
    case "right-arm-raise":
      return "Good. Continue with the right arm raise and lift slowly.";
    case "left-arm-raise":
      return "Good. Continue with the left arm raise and lift slowly.";
    case "both-arm-raise":
      return "Good. Continue lifting both arms evenly and with control.";
    case "sit-to-stand":
      return "Good. Stand tall again, then lower back down slowly.";
    default:
      return buildGenericContinuation(prescription);
  }
}

function buildRepFailureGuidance(
  prescription: ExercisePrescription,
  primaryIssue?: string | null,
  detectedIssues?: string[]
): string {
  const issueCue = buildIssueSpecificCorrection(
    prescription,
    primaryIssue,
    detectedIssues
  );

  if (issueCue) {
    switch (prescription.id) {
      case "right-arm-raise":
      case "left-arm-raise":
      case "both-arm-raise":
        return `${issueCue} Reset, then try again slowly.`;
      case "sit-to-stand":
        return `${issueCue} Reset, then try again slowly.`;
      default:
        return `${issueCue} Reset and try again slowly.`;
    }
  }

  switch (prescription.id) {
    case "right-arm-raise":
      return "Reset your right arm, then lift again slowly.";
    case "left-arm-raise":
      return "Reset your left arm, then lift again slowly.";
    case "both-arm-raise":
      return "Reset both arms, then lift them together again.";
    case "sit-to-stand":
      return "Reset in the chair, then try again slowly.";
    default:
      return "Reset and try again slowly.";
  }
}

function buildHoldCountdownMessage(
  holdRemainingMs: number,
  phase: string,
  primaryIssue?: string | null,
  detectedIssues?: string[]
): string | null {
  if (phase !== "holding") return null;

  if (
    primaryIssue === "shoulder_tilt" ||
    hasIssue(detectedIssues, "shoulder_tilt")
  ) {
    const seconds = Math.max(1, Math.ceil(holdRemainingMs / 1000));
    if (seconds >= 2) return `Hold steady and keep your shoulders level. ${seconds}.`;
    return "Hold steady and keep your shoulders level.";
  }

  const seconds = Math.max(1, Math.ceil(holdRemainingMs / 1000));

  if (seconds >= 3) return `Hold steady. ${seconds}.`;
  if (seconds === 2) return "Hold. Two.";
  if (seconds === 1) return "Hold. One.";

  return "Hold steady.";
}

function buildLoweringCue(
  primaryIssue?: string | null,
  detectedIssues?: string[]
): string {
  if (primaryIssue === "too_fast" || hasIssue(detectedIssues, "too_fast")) {
    return "Lower more slowly and stay in control.";
  }

  return "Lower slowly and stay in control.";
}

export function buildGuidedMessage(params: GuidanceParams): string | null {
  const {
    event,
    prescription,
    repState,
    holdRemainingMs,
    previousPhase,
    currentPhase,
    primaryIssue,
    detectedIssues
  } = params;

  if (event === "start") {
    return buildExerciseIntro(prescription);
  }

  if (event === "rep_complete") {
    return buildRepSuccessGuidance(
      prescription,
      repState.repCount,
      prescription.repTarget,
      primaryIssue,
      detectedIssues
    );
  }

  if (event === "rep_failed") {
    return buildRepFailureGuidance(
      prescription,
      primaryIssue,
      detectedIssues
    );
  }

  if (event === "exercise_complete") {
    return getExerciseCompleteCue(prescription);
  }

  if (holdRemainingMs !== null) {
    return buildHoldCountdownMessage(
      holdRemainingMs,
      currentPhase,
      primaryIssue,
      detectedIssues
    );
  }

  if (previousPhase !== currentPhase && currentPhase === "lowering") {
    return buildLoweringCue(primaryIssue, detectedIssues);
  }

  return null;
}
