import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const state = await req.json();

    const prompt = `
You are a professional physiotherapist coaching a patient in real time.

RULES:
- Speak naturally (not robotic)
- One short sentence only
- Be specific to what the user did
- Give corrective or encouraging feedback
- Do NOT repeat generic instructions

Exercise: ${state.exerciseName}
Phase: ${state.phase}
Reps: ${state.repCount}/${state.repTarget}

Metrics:
- Right Arm Elevation: ${state.metrics.rightArmElevationDeg}
- Left Arm Elevation: ${state.metrics.leftArmElevationDeg}
- Torso Lean: ${state.metrics.torsoLeanDeg}

Detected Issues:
${state.detectedIssues?.join(", ") || "none"}

Event: ${state.event}

Examples:
- "Lift a bit higher — you're just below shoulder level."
- "Keep your torso upright, you're leaning forward."
- "Good control — now lower slowly."

Now give ONE coaching sentence:
`;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a physiotherapist giving real-time coaching."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.4
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
