// ============================================================
// app/api/session/progress/route.ts
// ============================================================
// Saves where a patient is in their session, so it can be resumed the same
// day (lib/session/resume.ts). Patients are not signed in, and row level
// security lets only clinic staff update sessions, so this runs on the
// server with the service role. Like the session page, the session id in
// the link is the key; this route changes nothing but the session's status
// and progress fields.
//
// POST { sessionId, status: "in_progress" | "paused" | "completed",
//        progress: { done: number[], total: number }, reason?: string }
// ============================================================

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/serviceClient";

const STATUSES = new Set(["in_progress", "paused", "completed"]);
const REASONS = new Set(["ended", "walked_away", "tab_closed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { sessionId, status, progress, reason } = body ?? {};
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const total = Number(progress?.total);
  const done: number[] = Array.isArray(progress?.done)
    ? Array.from(new Set<number>(progress.done.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 200)))
    : [];
  if (!Number.isInteger(total) || total < 0 || total > 200) {
    return NextResponse.json({ error: "Invalid progress" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    progress: { done: done.sort((a, b) => a - b), total, updated_at: new Date().toISOString() },
    paused_at: status === "paused" ? new Date().toISOString() : null,
    pause_reason: status === "paused" && REASONS.has(reason) ? reason : null,
  };

  const supabase = getServiceClient();
  const { data, error } = await supabase.from("sessions").update(update).eq("id", sessionId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
