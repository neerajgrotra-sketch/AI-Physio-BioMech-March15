import { NextResponse } from "next/server";

export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        ok: false,
        status: null,
        error: "Missing OPENAI_API_KEY"
      });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 10,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: "Reply with exactly the word OK."
          }
        ]
      })
    });

    const text = await response.text();

    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      model: "gpt-4o-mini",
      body:
        parsed?.choices?.[0]?.message?.content ??
        parsed?.error?.message ??
        text
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
