import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

type RehabState = {
  exerciseId: string;
  exerciseName: string;
  template: string;
  side: string;
  phase: string;
  repCount: number;
  repTarget: number;
  posture: string;
  isStanding: boolean;
  isSeated: boolean;
  metrics: {
    rightArmElevationDeg: number | null;
    leftArmElevationDeg: number | null;
    hipHeightNormalized: number | null;
    torsoLeanDeg: number | null;
  };
  issues: string[];
  failureReason: string | null;
  event:
    | "start"
    | "phase_change"
    | "rep_complete"
    | "rep_failed"
    | "exercise_complete"
    | "idle";
};

function buildPrompt(state: RehabState): string {
  return `
You are a professional physiotherapist coaching an older adult during a live rehabilitation session.

Be:
- short
- warm
- clear
- actionable
- safe for seniors

Rules:
- maximum 18 words
- sound like a calm human physiotherapist, not a machine
- prefer natural phrases over generic commands
- one instruction at a time
- do not mention raw metric names
- if event is "start", explain what to do first
- if event is "phase_change", coach the next step
- if event is "rep_complete", encourage briefly
- if event is "rep_failed", explain the correction simply
- if event is "exercise_complete", congratulate briefly

Structured rehab state:
${JSON.stringify(state, null, 2)}

Return only the coaching sentence.
`.trim();
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const rehabState = (await request.json()) as RehabState;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4",
      input: buildPrompt(rehabState)
    });

    return NextResponse.json({
      message: response.output_text?.trim() || ""
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown OpenAI API error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
