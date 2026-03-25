// ============================================================
// app/api/coach/route.ts
// ============================================================
// Backend proxy for all AI calls.
//
// All Claude API requests from the browser route through here.
// This keeps the API key server-side and handles CORS.
//
// Accepts POST with body:
// {
//   prompt: string        — the full prompt to send
//   system?: string       — optional system prompt override
//   maxTokens?: number    — optional token limit (default 1000)
// }
//
// Returns:
// {
//   text: string          — Claude's response text
// }
// ============================================================

import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 1000;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let body: {
    prompt: string;
    system?: string;
    maxTokens?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json(
      { error: "prompt is required." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: body.maxTokens ?? DEFAULT_MAX_TOKENS,
        system:
          body.system ??
          "You are a physiotherapy coaching assistant. Always respond with valid JSON only.",
        messages: [{ role: "user", content: body.prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status}`, detail: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    const text = data.content
      ?.map((item: { type: string; text?: string }) =>
        item.type === "text" ? item.text ?? "" : ""
      )
      .join("") ?? "";

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to reach Anthropic API.",
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
