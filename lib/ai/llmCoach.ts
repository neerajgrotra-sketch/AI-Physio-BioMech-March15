import type { RehabState } from "@/lib/engine/rehabStateBuilder";

export async function generateCoaching(
  state: RehabState
): Promise<string | null> {
  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state)
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.message ?? null;
  } catch (error) {
    console.error("AI coaching error:", error);
    return null;
  }
}
