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
You are a real physiotherapist guiding a live rehab exercise.

Your job is not only to correct mistakes.
Your job is to guide the patient through the movement.

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
Respond with exactly ONE short coaching sentence.
Maximum 14 words.

Behavior:
- If event is start, guide the first movement clearly.
- If event is rep_complete, briefly acknowledge success and guide the next rep.
- If event is rep_failed, clearly correct the most important issue.
- If a repeated issue exists, prioritize that issue.
- If phase is holding, encourage stability.
- If phase is lowering, guide controlled descent.

Tone:
- calm
- confident
- human
- slightly encouraging
- never robotic

Avoid:
- "begin when ready"
- generic praise alone
- mentioning metrics, data, or analysis
- sounding like a chatbot

Examples:
- "Lift your right arm slowly to shoulder height."
- "Good. Now repeat that with the same control."
- "Lift a little higher on this next rep."
- "Hold steady. Stay tall through your torso."
- "Lower slowly and keep control."
- "Reset your arm, then try again."
- "Good. Keep both arms even this time."

Return ONLY the sentence.
`.trim();
}

export async function POST(req: NextRequest) {
  const model = "gpt-4o-mini";

  try {
    const state = (await req.json()) as CoachState;
    const prompt = buildPrompt(state);

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.45,
        max_tokens: 50,
        messages: [
          {
            role: "system",
            content:
              "You are a physiotherapist giving short live exercise guidance."
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

      let parsedError: any = null;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        parsedError = null;
      }

      const fallback = "Move slowly and stay in control.";

      return NextResponse.json({
        message: fallback,
        debug: {
          openAiStatus: aiResponse.status,
          usedFallback: true,
          promptPreview: prompt.slice(0, 1200),
          model,
          openAiError:
            parsedError?.error?.message ??
            parsedError?.message ??
            errorText
        }
      });
    }

    const json = await aiResponse.json();

    const message =
      json.choices?.[0]?.message?.content?.trim() ||
      "Move slowly and stay in control.";

    return NextResponse.json({
      message,
      debug: {
        openAiStatus: aiResponse.status,
        usedFallback: false,
        promptPreview: prompt.slice(0, 1200),
        model,
        openAiError: null
      }
    });
  } catch (error) {
    const fallback = "Move slowly and stay in control.";

    return NextResponse.json({
      message: fallback,
      debug: {
        openAiStatus: null,
        usedFallback: true,
        promptPreview: null,
        model,
        openAiError: error instanceof Error ? error.message : "Unknown route error."
      }
    });
  }
}
