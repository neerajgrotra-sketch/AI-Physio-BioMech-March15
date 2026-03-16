import type { CoachingDecision } from "@/lib/types/coaching";
import type { InterpreterOutput } from "@/lib/interpreter/movementInterpreter";
import type { ExercisePrescription } from "@/lib/types/exercise";

export function buildCoachingDecision(
  output: InterpreterOutput,
  prescription: ExercisePrescription
): CoachingDecision {
  switch (output.primaryIssue) {
    case "person_not_detected":
      return {
        code: "person_not_detected",
        priority: "info",
        message: "Please step into view so I can track your movement."
      };

    case "good_rep":
      return {
        code: "good_rep",
        priority: "encourage",
        message: prescription.coaching.success
      };

    case "rep_failed_hold":
      return {
        code: "rep_failed_hold",
        priority: "correct",
        message: prescription.coaching.failedHold
      };

    case "rep_failed_height":
      return {
        code: "rep_failed_height",
        priority: "correct",
        message: prescription.coaching.failedHeight
      };

    case "rep_failed_balance":
      return {
        code: "rep_failed_balance",
        priority: "correct",
        message: prescription.coaching.failedBalance
      };

    case "lift_higher":
      return {
        code: "lift_higher",
        priority: "correct",
        message: prescription.coaching.lift
      };

    case "hold_position":
      return {
        code: "hold_position",
        priority: "info",
        message: prescription.coaching.hold
      };

    case "keep_holding":
      return {
        code: "keep_holding",
        priority: "info",
        message: prescription.coaching.hold
      };

    case "hold_complete":
      return {
        code: "hold_complete",
        priority: "encourage",
        message: prescription.coaching.lower
      };

    case "lower_slowly":
      return {
        code: "lower_slowly",
        priority: "correct",
        message: prescription.coaching.lower
      };

    case "keep_balanced":
      return {
        code: "keep_balanced",
        priority: "correct",
        message: "Try to stay upright and balanced."
      };

    case "exercise_complete":
      return {
        code: "exercise_complete",
        priority: "encourage",
        message: "Exercise complete. Well done."
      };

    case "start_exercise":
      return {
        code: "start_exercise",
        priority: "info",
        message: prescription.coaching.intro
      };

    default:
      return {
        code: "idle",
        priority: "info",
        message: "Tracking movement."
      };
  }
}
