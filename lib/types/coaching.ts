export type CoachingPriority = "info" | "correct" | "encourage";

export type CoachingCode =
  | "idle"
  | "start_exercise"
  | "person_not_detected"
  | "good_rep"
  | "lift_higher"
  | "lower_slowly"
  | "keep_balanced"
  | "exercise_complete";

export type CoachingDecision = {
  code: CoachingCode;
  priority: CoachingPriority;
  message: string;
};
