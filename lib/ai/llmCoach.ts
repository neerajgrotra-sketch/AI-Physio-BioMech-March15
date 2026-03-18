import type { RehabState } from "@/lib/engine/rehabStateBuilder";

export async function generateCoaching(state: RehabState): Promise<string> {
  // TEMP RULE-BASED MOCK (replace with OpenAI later)

  if (state.event === "start") {
    return `Let's begin ${state.exerciseName}. Follow my instructions.`;
  }

  if (state.event === "rep_complete") {
    return `Good job. ${state.repTarget - state.repCount} reps remaining.`;
  }

  if (state.event === "rep_failed") {
    return `That rep did not meet the target. Try again with control.`;
  }

  if (state.phase === "lifting") {
    return "Raise your arm slowly.";
  }

  if (state.phase === "holding") {
    return "Hold steady.";
  }

  if (state.phase === "lowering") {
    return "Lower with control.";
  }

  return "";
}
