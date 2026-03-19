import { NextRequest, NextResponse } from "next/server";

type CoachState = {
  exerciseName: string;
  template: string;
  side: string;
  phase: string;
  event: string;
  repCount: number;
  repTarget: number;
  posture: string;
  isStanding: boolean;
  isSeated: boolean;
  detectedIssues: string[];
  failureReason: string | null;
  evaluation?: {
    reachedTarget?: boolean;
    holdSatisfied?: boolean;
  };
  intent?: string;
  history?: {
    repeatedIssue?: string;
    repeatedIssueCount?: number;
    dominantIssue?: string;
    trend?: string;
    consecutiveSuccesses?: number;
    consecutiveFailures?: number;
    recentEvents?: string[];
  };
};

function buildPrompt(state: CoachState): string {
  const issues =
    state.detectedIssues.length > 0 ? state.detectedIssues.join(", ") : "none";

  const repeatedLabel =
    state.history?.repeatedIssue && state.history.repeatedIssueCount
      ? `${state.history.repeatedIssue} (${state.history.repeatedIssueCount} times)`
      : "none";

  return `
You are a real physiotherapist giving short live coaching during a rehab session.

SESSION CONTEXT
Exercise: ${state.exerciseName}
Template: ${state.template}
Side: ${state.side}
Phase: ${state.phase}
Event: ${state.event}
Reps: ${state.repCount}/${state.repTarget}

PATIENT STATE
Posture: ${state.posture}
Standing: ${state.isStanding}
Seated: ${state.isSeated}

MOVEMENT QUALITY
Detected issues: ${issues}
Failure reason: ${state.failureReason ?? "none"}
Reached target: ${state.evaluation?.reachedTarget ?? false}
Hold satisfied: ${state.evaluation?.holdSatisfied ?? false}

MEMORY
Repeated issue: ${repeatedLabel}
Dominant issue: ${state.history?.dominantIssue ?? "none"}
Trend: ${state.history?.trend ?? "stable"}
Consecutive successes: ${state.history?.consecutiveSuccesses ?? 0}
Consecutive failures: ${state.history?.consecutiveFailures ?? 0}

COACHING GOAL
Intent: ${state.intent ?? "stabilize"}

INSTRUCTIONS
Return exactly ONE short coaching sentence.
Maximum 12 words.
Sound calm, natural, and specific.
Focus on only the most important cue.
Do not mention angles, metrics, analytics, or data.
Do not say "begin when ready".
Do not narrate what the model sees.
Do not use more than one sentence.

STYLE EXAMPLES
- "Lift a little higher."
- "Good, now lower slowly."
- "Stay tall through your torso."
- "Hold it there."
- "Better — keep both arms even."
- "Reset and try that rep again."
- "Nice rep. Keep that control."

Now return the best single coaching sentence.
`.trim();
}

export async function POST(req: NextRequest) {
  const model = "gpt-4o-mini";

  try {
    const state = (await req.json()) as CoachState;
    const prompt = buildPrompt(state);

    console.log("coach route hit", {
      event: state.event,
      exerciseName: state.exerciseName,
      intent: state.intent
    });

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content:
              "You are a physiotherapist giving brief real-time movement coaching."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    console.log("openai status", aiResponse.status);

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("OpenAI coach API error:", errorText);

      const fallback = "Keep the movement slow and controlled.";

      return NextResponse.json({
        message: fallback,
        debug: {
          openAiStatus: aiResponse.status,
          usedFallback: true,
          promptPreview: prompt.slice(0, 1200),
          model
        }
      });
    }

    const json = await aiResponse.json();

    const message =
      json.choices?.[0]?.message?.content?.trim() ||
      "Keep the movement slow and controlled.";

    return NextResponse.json({
      message,
      debug: {
        openAiStatus: aiResponse.status,
        usedFallback: false,
        promptPreview: prompt.slice(0, 1200),
        model
      }
    });
  } catch (error) {
    console.error("Coach API route error:", error);

    const fallback = "Keep the movement slow and controlled.";

    return NextResponse.json({
      message: fallback,
      debug: {
        openAiStatus: null,
        usedFallback: true,
        promptPreview: null,
        model,
        error: error instanceof Error ? error.message : "Unknown route error."
      }
    });
  }
}
