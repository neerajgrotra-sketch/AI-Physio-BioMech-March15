// The assignment code: a short, readable name for one protocol assigned to
// one patient (a `sessions` row). Shown on the admin card, the session
// screen and the top of every saved debug log, so a tester and Claude can
// refer to the same assignment. In the database: sessions.id starts with
// the 8 characters (session_results.prescription_id and
// session_debug_logs.session_id hold the same id; sessions.source_protocol_id
// is the protocol it came from).
export function assignmentCode(sessionId: string | null | undefined): string {
  if (!sessionId) return "";
  return `A-${sessionId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
