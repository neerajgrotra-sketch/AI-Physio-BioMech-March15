// ============================================================
// lib/session/resume.ts
// ============================================================
// Picking a session up again, and noticing the patient has walked away
// (the owner's decisions, 2026-11-27):
//   - a session ended (or left) with exercises to go can be resumed the SAME
//     DAY, from the first unfinished exercise; finished exercises stay done,
//     an exercise cut off part way starts again. The next day it starts fresh.
//   - nobody seen for AWAY_PAUSE_S: the session pauses itself; from
//     AWAY_COUNTDOWN_S a countdown shows; at AWAY_END_S it is saved and ends.
// Pure. Tested by resume.test.ts. Progress is written by
// app/api/session/progress into sessions.progress.
// ============================================================

export type SessionProgress = { done: number[]; total: number; updated_at: string };

export type ResumePlan = {
  resumable: boolean;
  done: number[];      // exercise indexes already finished (sorted, unique)
  remaining: number[]; // the indexes still to do, in order
};

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Whether (and from where) a session can be picked up again now. */
export function resumePlan(input: {
  status: string | null | undefined;
  progress: SessionProgress | null | undefined;
  total: number;
  now: Date;
}): ResumePlan {
  const all = Array.from({ length: Math.max(0, input.total) }, (_, i) => i);
  const fresh: ResumePlan = { resumable: false, done: [], remaining: all };
  const p = input.progress;
  if (!p || !Array.isArray(p.done) || (input.status !== "paused" && input.status !== "in_progress")) return fresh;
  // The protocol changed since (exercises added or removed): start fresh.
  if (p.total !== input.total) return fresh;
  const when = new Date(p.updated_at);
  if (isNaN(when.getTime()) || !sameLocalDay(when, input.now)) return fresh;
  const done = Array.from(new Set(p.done.filter((i) => Number.isInteger(i) && i >= 0 && i < input.total))).sort((a, b) => a - b);
  const remaining = all.filter((i) => !done.includes(i));
  if (done.length === 0 || remaining.length === 0) return fresh;
  return { resumable: true, done, remaining };
}

// ── Walking away ─────────────────────────────────────────────
export const AWAY_PAUSE_S = 10;
export const AWAY_COUNTDOWN_S = 60;
export const AWAY_END_S = 90;

export type AwayState =
  | { kind: "present" }
  | { kind: "paused"; unseenS: number }
  | { kind: "countdown"; secondsLeft: number }
  | { kind: "end" };

/** What to do after the patient has not been seen for `unseenS` seconds. */
export function awayState(unseenS: number): AwayState {
  if (unseenS < AWAY_PAUSE_S) return { kind: "present" };
  if (unseenS < AWAY_COUNTDOWN_S) return { kind: "paused", unseenS };
  if (unseenS < AWAY_END_S) return { kind: "countdown", secondsLeft: Math.ceil(AWAY_END_S - unseenS) };
  return { kind: "end" };
}
