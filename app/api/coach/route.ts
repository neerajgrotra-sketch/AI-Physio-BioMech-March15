import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const state = await req.json();

    const prompt = `
You are a professional physiotherapist coaching a patient live.

STYLE:
- Natural, human, conversational
- Max 12 words
- Never robotic
- Never generic

GOAL:
- Improve movement quality
- Focus ONLY on the most important issue

CONTEXT:
Exercise: ${state.exerciseName}
Phase: ${state.phase}
Reps: ${state.repCount}/${state.repTarget}

Intent: ${state.intent}

Issues:
${state.detectedIssues.join(", ") || "none"}

History:
- Repeated issue: ${state.history?.repeatedIssue || "none"}
- Trend: ${state.history?.trend || "stable"}

RULES:
- If issue exists → correct clearly
- If repeated → emphasize ("still", "again")
- If improving → encourage
- If starting → guide
- NEVER say "begin when ready"

EXAMPLES:
- "Lift higher — you're still below shoulder level."
- "Better, now slow it down."
- "Keep your torso upright."
- "Good rep — now control the descent."

Return ONE short coaching sentence.
`;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a physiotherapist giving real-time movement coaching."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.5
      })
    });

    const json = await aiResponse.json();

    const message =
      json.choices?.[0]?.message?.content?.trim() ??
      "Adjust your movement and try again.";

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Coach API error:", error);

    return NextResponse.json({
      message: "Focus on controlled movement."
    });
  }
}
