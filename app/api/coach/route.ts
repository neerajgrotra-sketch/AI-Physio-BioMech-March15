// ============================================================
// app/api/coach/route.ts
// ============================================================
// Server proxy for the AI coach (Claude). Keeps the API key on the server.
//
// v0.13.0: every call had been failing with "Anthropic API error: 404" since
// the model it named (claude-sonnet-4-20250514) was retired, so sessions
// only ever used the built-in fallback lines. Now on the official SDK and a
// current model (COACH_MODEL overrides it), with server-side refusal
// fallbacks, and it accepts both request shapes the app sends.
//
// POST body (either):
//   { prompt: string, system?: string, maxTokens?: number }
//   { messages: [{ role, content }], system?: string, maxTokens?: number }
// Returns { text, ms, model } (and `content: [{ type: "text", text }]` for
// older callers that read the raw Messages shape).
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const MODEL = process.env.COACH_MODEL || "claude-opus-5-5";
const DEFAULT_MAX_TOKENS = 1000;
const DEFAULT_SYSTEM = "You are a physiotherapy coaching assistant. Always respond with valid JSON only.";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

type Body = {
  prompt?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  system?: string;
  maxTokens?: number;
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 500 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages: Anthropic.Beta.BetaMessageParam[] =
    typeof body.prompt === "string" && body.prompt
      ? [{ role: "user", content: body.prompt }]
      : Array.isArray(body.messages)
        ? body.messages
            .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
            .map((m) => ({ role: m.role, content: m.content }))
        : [];
  if (!messages.length || messages[0].role !== "user") {
    return NextResponse.json({ error: "prompt (or messages starting with a user turn) is required." }, { status: 400 });
  }

  const started = Date.now();
  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: Math.min(Math.max(body.maxTokens ?? DEFAULT_MAX_TOKENS, 64), 4000),
      // Live coaching: short answers, fast. Low effort keeps the reply quick.
      output_config: { effort: "low" },
      system: body.system ?? DEFAULT_SYSTEM,
      messages,
      // If a request is declined by a safety classifier, the API re-runs it on
      // a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The model declined this request.", ms: Date.now() - started }, { status: 502 });
    }
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return NextResponse.json({
      text,
      content: [{ type: "text", text }],
      ms: Date.now() - started,
      model: response.model,
    });
  } catch (error) {
    if (error instanceof Anthropic.NotFoundError) {
      return NextResponse.json({ error: `Model not found: ${MODEL}` }, { status: 502 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic API error: ${error.status}`, detail: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to reach the AI coach.", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
