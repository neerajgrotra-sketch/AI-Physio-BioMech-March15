import type { RehabState } from "@/lib/engine/rehabStateBuilder";

export type CoachingIntent =
  | "correct_form"
  | "encourage"
  | "guide_next"
  | "stabilize";

export function deriveCoachingIntent(state: RehabState): CoachingIntent {
  if (state.event === "rep_failed") return "correct_form";

  if (state.event === "rep_complete") return "encourage";

  if (state.detectedIssues.length > 0) return "correct_form";

  if (state.phase === "ready") return "guide_next";

  return "stabilize";
}
