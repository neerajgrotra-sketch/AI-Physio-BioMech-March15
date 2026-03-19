import type { RehabState } from "@/lib/engine/rehabStateBuilder";
import { deriveCoachingIntent } from "@/lib/engine/coachingIntent";
import { buildHistory } from "@/lib/engine/historyTracker";

export async function generateCoaching(
  state: RehabState
): Promise<string | null> {
  try {
    const intent = deriveCoachingIntent(state);
    const history = buildHistory(state);

    const enrichedState = {
      ...state,
      intent,
      history
    };

    const response = await fetch("/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(enrichedState)
    });

    if (!response.ok) return null;

    const data = await response.json();
    return typeof data.message === "string" ? data.message : null;
  } catch (error) {
    console.error("AI coaching error:", error);
    return null;
  }
}
