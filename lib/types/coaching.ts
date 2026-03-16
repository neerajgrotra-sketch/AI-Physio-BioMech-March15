export type CoachingPriority = "info" | "correct" | "encourage";

export type CoachingCode =
  | "idle"
  | "start_exercise"
  | "person_not_detected"
  | "good_rep"
  | "rep_failed_hold"
  | "rep_failed_height"
  | "rep_failed_balance"
  | "lift_higher"
  | "hold_position"
  | "keep_holding"
  | "hold_complete"
  | "lower_slowly"
  | "keep_balanced"
  | "exercise_complete";

export type CoachingDecision = {
  code: CoachingCode;
  priority: CoachingPriority;
  message: string;
};
