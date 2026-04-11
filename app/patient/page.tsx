"use client";

// app/patient/page.tsx
// Patient session landing page.
// Route: /patient?id=UUID
//
// Fetches the patient record from patients_mvp, then loads all
// session_prescriptions assigned to them. Patient sees their
// name, assigned sessions with status, and can run any session.
//
// No auth — MVP uses direct UUID link. Auth + RLS to follow.

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";

// ─── Colour palette (matches admin + session pages) ───────────────────────────

const C = {
  bg:           "#0d1117",
  surface:      "#161b22",
  surfaceHover: "#1c2230",
  border:       "#21262d",
  text:         "#e6edf3",
  textMuted:    "#7d8590",
  textDim:      "#484f58",
  green:        "#3fb950",
  greenDim:     "rgba(63,185,80,0.12)",
  blue:         "#388bfd",
  blueDim:      "rgba(56,139,253,0.12)",
  orange:       "#d29922",
  orangeDim:    "rgba(210,153,34,0.12)",
  red:          "#f85149",
  purple:       "#a371f7",
  purpleDim:    "rgba(163,113,247,0.12)",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PrescriptionStatus = "pending" | "in_progress" | "completed" | "missed" | "cancelled";

interface PatientRow {
  id: string;
  full_name: string;
  patient_type: string;
  condition_notes: string | null;
  photo_url: string | null;
}

interface SessionRow {
  id: string;
  title: string;
  objective: string | null;
  status: PrescriptionStatus;
  estimated_duration_mins: number;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PATIENT_TYPE_LABELS: Record<string, string> = {
  general_fitness: "General Fitness",
  post_surgery:    "Post Surgery",
  senior:          "Senior / Elderly",
  chronic_pain:    "Chronic Pain",
};

const STATUS_CONFIG: Record<PrescriptionStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: "Pending",     color: C.blue,   bg: C.blueDim },
  in_progress: { label: "In Progress", color: C.orange, bg: C.orangeDim },
  completed:   { label: "Completed",   color: C.green,  bg: C.greenDim },
  missed:      { label: "Missed",      color: C.red,    bg: "rgba(248,81,73,0.12)" },
  cancelled:   { label: "Cancelled",   color: C.textDim, bg: "transparent" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PrescriptionStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
      padding: "3px 8px", borderRadius: 20,
      color: cfg.color, background: cfg.bg,
      textTransform: "uppercase",
    }}>
      {cfg.label}
    </span>
  );
}

function SessionCard({ session }: { session: SessionRow }) {
  const isRunnable = session.status === "pending" || session.status === "in_progress";
  const isCompleted = session.status === "completed";
  const buttonLabel = isCompleted ? "↺ Re-run" : "▶ Run Session";

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {session.title}
          </div>
          {session.objective && (
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
              {session.objective}
            </div>
          )}
        </div>
        <StatusBadge status={session.status} />
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", gap: 16 }}>
        <span style={{ fontSize: 12, color: C.textDim }}>
          ⏱ {session.estimated_duration_mins} min
        </span>
        <span style={{ fontSize: 12, color: C.textDim }}>
          📅 {formatDate(session.created_at)}
        </span>
      </div>

      {/* Action */}
      {(isRunnable || isCompleted) && (
        <div style={{ marginTop: 4 }}>
          <button
            onClick={() => window.location.href = `/session?prescription=${session.id}`}
            style={{
              padding: "9px 20px",
              background: isCompleted ? "transparent" : C.blue,
              color: isCompleted ? C.textMuted : "#fff",
              border: isCompleted ? `1px solid ${C.border}` : "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            {buttonLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function PatientAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: `2px solid ${C.border}` }}
      />
    );
  }
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: 56, height: 56, borderRadius: "50%",
      background: C.blueDim, border: `2px solid ${C.blue}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 18, fontWeight: 700, color: C.blue,
    }}>
      {initials}
    </div>
  );
}

// ─── Screens ──────────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={screenWrap}>
      <div style={{ fontSize: 32 }}>⚡</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>AI Physio</div>
      <div style={{ fontSize: 14, color: C.textMuted }}>Loading your sessions…</div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={screenWrap}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>No Active Sessions Found</div>
      <div style={{
        fontSize: 14, color: C.textMuted,
        maxWidth: 360, textAlign: "center", lineHeight: 1.7,
      }}>
        {message}
      </div>
      <div style={{
        marginTop: 8,
        padding: "12px 20px",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        fontSize: 13, color: C.textMuted,
        textAlign: "center", lineHeight: 1.6,
        maxWidth: 320,
      }}>
        Contact your physiotherapist or clinic to get a session link.
      </div>
    </div>
  );
}

const screenWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: C.bg,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
  padding: 32,
};

// ─── Main inner page ──────────────────────────────────────────────────────────

function PatientPageInner() {
  const searchParams = useSearchParams();
  const patientId = searchParams.get("id");

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const supabase = getSupabaseClient();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // No id param — show error immediately
    if (!patientId) {
      setErrorMessage("No patient ID was provided in the link.");
      setStatus("error");
      return;
    }

    async function load() {
      try {
        // Fetch patient record
        const { data: pt, error: ptErr } = await supabase
          .from("patients")
          .select("id, full_name, patient_type, condition_notes, photo_url")
          .eq("id", patientId)
          .single();

        if (ptErr || !pt) {
          setErrorMessage("We couldn't find your patient record. Your link may be incorrect or expired.");
          setStatus("error");
          return;
        }

        setPatient(pt as PatientRow);

        // Fetch all sessions assigned to this patient
        const { data: sess, error: sessErr } = await supabase
          .from("sessions")
          .select("id, title, objective, status, estimated_duration_mins, created_at")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false });

        if (sessErr) {
          setErrorMessage("Your profile was found but we couldn't load your sessions. Please try again.");
          setStatus("error");
          return;
        }

        setSessions((sess ?? []) as SessionRow[]);
        setStatus("ready");
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred.");
        setStatus("error");
      }
    }

    load();
  }, [patientId, supabase]);

  if (status === "loading") return <LoadingScreen />;
  if (status === "error")   return <ErrorScreen message={errorMessage} />;

  // Split sessions into active (pending/in_progress) and past (completed/missed/cancelled)
  const activeSessions = sessions.filter(s => s.status === "pending" || s.status === "in_progress");
  const pastSessions   = sessions.filter(s => s.status === "completed" || s.status === "missed" || s.status === "cancelled");

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
      color: C.text,
    }}>
      {/* Top bar */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>⚡ AI Physio</span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>

        {/* Patient header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16, marginBottom: 36,
        }}>
          <PatientAvatar name={patient!.full_name} photoUrl={patient!.photo_url} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
              {patient!.full_name}
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 3 }}>
              {PATIENT_TYPE_LABELS[patient!.patient_type] ?? patient!.patient_type}
            </div>
          </div>
        </div>

        {/* Active sessions */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>
            Your Sessions ({activeSessions.length})
          </div>

          {activeSessions.length === 0 ? (
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: "28px 24px",
              textAlign: "center", color: C.textMuted, fontSize: 14,
            }}>
              No sessions assigned yet. Your physiotherapist will add sessions here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeSessions.map(s => <SessionCard key={s.id} session={s} />)}
            </div>
          )}
        </div>

        {/* Past sessions */}
        {pastSessions.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>
              Past Sessions ({pastSessions.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pastSessions.map(s => <SessionCard key={s.id} session={s} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function PatientPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh", background: "#0d1117",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#7d8590", fontFamily: "sans-serif",
      }}>
        Loading…
      </div>
    }>
      <PatientPageInner />
    </Suspense>
  );
}
