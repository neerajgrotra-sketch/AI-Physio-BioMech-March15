import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RehabEvent } from "@/lib/engine/rehabStateBuilder";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";

function getExerciseCoreInstruction(prescription: ExercisePrescription): string {
  switch (prescription.id) {
    case "right-arm-raise":
      return "Lift your right arm to shoulder height, hold, then lower slowly.";

    case "left-arm-raise":
      return "Lift your left arm to shoulder height, hold, then lower slowly.";

    case "both-arm-raise":
      return "Lift both arms evenly to shoulder height, hold, then lower slowly.";

    case "sit-to-stand":
      return "Stand up fully, pause, then sit down slowly with control.";

    default:
      return "Move slowly and with control.";
  }
}

function getExerciseContinuation(prescription: ExercisePrescription): string {
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

function getFailureResetCue(prescription: ExercisePrescription): string {
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
      return `${prescription.name}. ${getExerciseCoreInstruction(prescription)}`;
  }
}

function buildRepSuccessGuidance(
  prescription: ExercisePrescription,
  repCount: number,
  repTarget: number
): string {
  const remaining = Math.max(0, repTarget - repCount);

  if (remaining <= 0) {
    return getExerciseCompleteCue(prescription);
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
      return getExerciseContinuation(prescription);
  }
}

function buildHoldCountdownMessage(
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

function buildLoweringCue(): string {
  return "Lower slowly and stay in control.";
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
    return buildRepSuccessGuidance(
      prescription,
      repState.repCount,
      prescription.repTarget
    );
  }

  if (event === "rep_failed") {
    return getFailureResetCue(prescription);
  }

  if (event === "exercise_complete") {
    return getExerciseCompleteCue(prescription);
  }

  if (holdRemainingMs !== null) {
    return buildHoldCountdownMessage(holdRemainingMs, currentPhase);
  }

  if (previousPhase !== currentPhase && currentPhase === "lowering") {
    return buildLoweringCue();
  }

  return null;
}
