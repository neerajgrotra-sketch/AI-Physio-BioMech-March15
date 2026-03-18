import type { RehabState } from "@/lib/engine/rehabStateBuilder";

function mockCoach(state: RehabState): string {
  if (state.event === "start") {
    if (state.exerciseId === "sit-to-stand") {
      return "Sit fully on the chair. When ready, stand up completely.";
    }

    return `Let's begin ${state.exerciseName}. Follow my instructions.`;
  }

  if (state.event === "phase_change") {
    if (state.phase === "lifting") {
      if (state.exerciseId === "sit-to-stand") {
        return "Stand up fully.";
      }
      return "Lift slowly with control.";
    }

    if (state.phase === "holding") {
      if (state.exerciseId === "sit-to-stand") {
        return "Hold your standing position.";
      }
      return "Hold steady.";
    }

    if (state.phase === "lowering") {
      if (state.exerciseId === "sit-to-stand") {
        return "Sit down slowly.";
      }
      return "Lower with control.";
    }
  }

  if (state.event === "rep_complete") {
    const remaining = Math.max(0, state.repTarget - state.repCount);
    if (remaining === 0) {
      return "Excellent. That exercise is complete.";
    }
    return `Good job. ${remaining} reps remaining.`;
  }

  if (state.event === "rep_failed") {
    if (state.failureReason === "failed_hold") {
      return "That rep did not count. Hold a little longer and try again.";
    }
    if (state.failureReason === "failed_height") {
      if (state.exerciseId === "sit-to-stand") {
        return "That rep did not count. Stand up fully before sitting back down.";
      }
      return "That rep did not count. Reach the target height and try again.";
    }
    if (state.failureReason === "failed_balance") {
      return "That rep did not count. Stay balanced and controlled.";
    }
    if (state.failureReason === "failed_isolation") {
      return "That rep did not count. Use only the instructed arm.";
    }
    if (state.failureReason === "failed_bilateral_participation") {
      return "That rep did not count. Move both arms together.";
    }
    return "That rep did not count. Reset and try again.";
  }

  if (state.event === "exercise_complete") {
    return "Exercise complete. Well done.";
  }

  return "";
}

export async function generateCoaching(state: RehabState): Promise<string> {
  // Replace this later with a real API call to OpenAI / Gemini / Qwen.
  return mockCoach(state);
}
