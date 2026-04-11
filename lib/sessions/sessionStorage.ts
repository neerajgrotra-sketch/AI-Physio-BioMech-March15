import type { TherapySession } from "@/lib/sessions/sessionTypes";

const STORAGE_KEY = "ai_physio_sessions_v1";

export function loadSessions(): TherapySession[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed as TherapySession[];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: TherapySession[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore for now
  }
}
