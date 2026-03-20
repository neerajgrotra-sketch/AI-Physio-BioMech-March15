import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RehabEvent } from "@/lib/engine/rehabStateBuilder";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";

export function buildExerciseIntro(prescription: ExercisePrescription): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "We are starting right arm raises. Lift to shoulder height, hold, then lower slowly.";

    case "left-arm-raise":
      return "We are starting left arm raises. Lift to shoulder height, hold, then lower slowly.";

    case "both-arm-raise":
      return "We are starting both arm raises. Lift both arms evenly, hold, then lower slowly.";

    case "sit-to-stand":
      return "We are starting sit to stand. Stand up fully, hold, then sit down slowly.";

    default:
      return `${prescription.name}. Move slowly and with control.`;
  }
}

export function buildNextRepGuidance(prescription: ExercisePrescription): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "Continue with the right arm raise. Lift slowly to shoulder height.";

    case "left-arm-raise":
      return "Continue with the left arm raise. Lift slowly to shoulder height.";

    case "both-arm-raise":
      return "Continue with both arms. Lift them together slowly and evenly.";

    case "sit-to-stand":
      return "Continue. Stand up smoothly, then lower back down with control.";

    default:
      return "Continue with the next repetition slowly and with control.";
  }
}

export function buildRepSuccessGuidance(
  prescription: ExercisePrescription,
  repCount: number
): string {
  if (repCount <= 0) {
    return buildNextRepGuidance(prescription);
  }

  switch (prescription.id) {
    case "right-arm-raise":
      return "Good. Continue with the right arm raise and lift slowly.";

    case "left-arm-raise":
      return "Good. Continue with the left arm raise and lift slowly.";

    case "both-arm-raise":
      return "Good. Continue lifting both arms evenly and with control.";

    case "sit-to-stand":
      return "Good. Continue standing tall, then lower back down slowly.";

    default:
      return "Good. Continue the next repetition with control.";
  }
}

export function buildRepFailureGuidance(
  prescription: ExercisePrescription
): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "Reset your right arm, then lift again slowly.";

    case "left-arm-raise":
      return "Reset your left arm, then lift again slowly.";

    case "both-arm-raise":
      return "Reset both arms, then lift them together again.";

    case "sit-to-stand":
      return "Reset in the chair, then try the movement again slowly.";

    default:
      return "Reset and try the repetition again slowly.";
  }
}

export function buildHoldCountdownMessage(
  holdRemainingMs: number,
  phase: string
): string | null {
  if (phase !== "holding") return null;

  const seconds = Math.max(1, Math.ceil(holdRemainingMs / 1000));

  if (seconds >= 3) return `Hold steady. ${seconds}.`;
  if (seconds === 2) return "Hold. Two.";
  if (seconds === 1) return "Hold. One.";

  return "Hold steady.";
}

export function buildLoweringCue(): string {
  return "Lower slowly and stay in control.";
}

export function buildExerciseCompleteMessage(
  prescription: ExercisePrescription
): string {
  return `${prescription.name} complete. Well done.`;
}

export function buildGuidedMessage(params: {
  event: RehabEvent;
  prescription: ExercisePrescription;
  repState: RuntimeRepState;
  holdRemainingMs: number | null;
  previousPhase: string;
  currentPhase: string;
}): string | null {
  const {
    event,
    prescription,
    repState,
    holdRemainingMs,
    previousPhase,
    currentPhase
  } = params;

  if (event === "start") {
    return buildExerciseIntro(prescription);
  }

  if (event === "rep_complete") {
    return buildRepSuccessGuidance(prescription, repState.repCount);
  }

  if (event === "rep_failed") {
    return buildRepFailureGuidance(prescription);
  }

  if (event === "exercise_complete") {
    return buildExerciseCompleteMessage(prescription);
  }

  if (
    previousPhase !== currentPhase &&
    currentPhase === "lowering"
  ) {
    return buildLoweringCue();
  }

  if (holdRemainingMs !== null) {
    return buildHoldCountdownMessage(holdRemainingMs, currentPhase);
  }

  return null;
}
