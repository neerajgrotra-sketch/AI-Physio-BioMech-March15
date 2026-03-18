import type { RehabState } from "@/lib/engine/rehabStateBuilder";

export async function generateCoaching(state: RehabState): Promise<string> {
  const response = await fetch("/api/coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(state)
  });

  if (!response.ok) {
    const fallback = await response.json().catch(() => null);
    throw new Error(fallback?.error || "Coach API request failed.");
  }

  const data = (await response.json()) as { message?: string };
  return data.message?.trim() || "";
}
