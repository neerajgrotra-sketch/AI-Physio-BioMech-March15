import type { RehabState } from "@/lib/engine/rehabStateBuilder";
import type { HistoryState } from "@/lib/engine/historyTracker";

export type CoachingIntent =
  | "correct_form"
  | "encourage"
  | "guide_next"
  | "stabilize"
  | "reinforce_progress"
  | "reset_and_retry";

export function deriveCoachingIntent(
  state: RehabState,
  history?: HistoryState
): CoachingIntent {
  if (state.event === "rep_failed") {
    if ((history?.consecutiveFailures ?? 0) >= 2) {
      return "reset_and_retry";
    }

    return "correct_form";
  }

  if (state.event === "rep_complete") {
    if ((history?.consecutiveSuccesses ?? 0) >= 2 || history?.trend === "improving") {
      return "reinforce_progress";
    }

    return "encourage";
  }

  if (state.event === "exercise_complete") {
    return "encourage";
  }

  if (state.phase === "ready" || state.event === "start") {
    return "guide_next";
  }

  if (history?.repeatedIssue && history.repeatedIssueCount >= 2) {
    return "correct_form";
  }

  if (state.detectedIssues.length > 0) {
    return "correct_form";
  }

  return "stabilize";
}
