import { NextRequest, NextResponse } from "next/server";

function buildPrompt(state: any): string {
  const issues =
    Array.isArray(state.detectedIssues) && state.detectedIssues.length > 0
      ? state.detectedIssues.join(", ")
      : "none";

  return `
You are a professional physiotherapist coaching a patient live during a rehab exercise.

Your job is to sound calm, natural, specific, and helpful.
You are NOT a chatbot.
You are giving short live coaching during movement.

PATIENT CONTEXT
Exercise: ${state.exerciseName}
Template: ${state.template}
Side: ${state.side}
Phase: ${state.phase}
Event: ${state.event}
Reps: ${state.repCount}/${state.repTarget}

POSTURE
Posture: ${state.posture}
Standing: ${state.isStanding}
Seated: ${state.isSeated}

MOVEMENT QUALITY
Detected issues: ${issues}
Failure reason: ${state.failureReason ?? "none"}

EVALUATION
Reached target: ${state.evaluation?.reachedTarget ?? false}
Hold satisfied: ${state.evaluation?.holdSatisfied ?? false}

HISTORY
Repeated issue: ${state.history?.repeatedIssue ?? "none"}
Trend: ${state.history?.trend ?? "stable"}

COACHING INTENT
Intent: ${state.intent ?? "stabilize"}

IMPORTANT RULES
- Return exactly ONE short coaching sentence
- Maximum 12 words
- Be direct and human
- Focus on the single most important correction or cue
- Do not explain
- Do not mention data, angles, metrics, or analysis
- Do not say "begin when ready"
- Do not sound robotic
- Prefer phrasing a real physiotherapist would use

STYLE EXAMPLES
- "Lift a little higher."
- "Good, now lower slowly."
- "Stay tall through your torso."
- "Hold it there."
- "Better — keep both arms even."
- "Nice rep. Let's do another."

Now return the best single coaching sentence.
`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const state = await req.json();
    const prompt = buildPrompt(state);

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.35,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content:
              "You are a physiotherapist giving short real-time movement coaching."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("OpenAI coach API error:", errorText);
      return NextResponse.json({
        message: "Keep the movement slow and controlled."
      });
    }

    const json = await aiResponse.json();

    const message =
      json.choices?.[0]?.message?.content?.trim() ||
      "Keep the movement slow and controlled.";

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Coach API route error:", error);
    return NextResponse.json({
      message: "Keep the movement slow and controlled."
    });
  }
}
