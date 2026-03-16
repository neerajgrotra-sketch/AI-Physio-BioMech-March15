import type { CoachingDecision } from "@/lib/types/coaching";
import type { InterpreterOutput } from "@/lib/interpreter/movementInterpreter";

export function buildCoachingDecision(
  output: InterpreterOutput
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
        message: "Good repetition. Keep going."
      };

    case "lift_higher":
      return {
        code: "lift_higher",
        priority: "correct",
        message: "Lift a little higher."
      };

    case "hold_position":
      return {
        code: "hold_position",
        priority: "info",
        message: "Good. Hold at the top."
      };

    case "keep_holding":
      return {
        code: "keep_holding",
        priority: "info",
        message: "Keep holding."
      };

    case "hold_complete":
      return {
        code: "hold_complete",
        priority: "encourage",
        message: "Good. Now lower slowly."
      };

    case "lower_slowly":
      return {
        code: "lower_slowly",
        priority: "correct",
        message: "Lower with control."
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
        message: "Begin when ready."
      };

    default:
      return {
        code: "idle",
        priority: "info",
        message: "Tracking movement."
      };
  }
}
