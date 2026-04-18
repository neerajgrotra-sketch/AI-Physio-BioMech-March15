"use client";

// app/session/SessionPageClient.tsx
// Client shell for the session runner. Receives pre-fetched prescription data
// as props from the server component (page.tsx). Never calls Supabase directly.
// Unauthenticated patients can run sessions — RLS is handled server-side.

import { Suspense } from "react";
import SessionRunner from "@/components/session/SessionRunner";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { PatientProfile } from "@/lib/patient/patientTypes";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SessionPageClientProps {
  prescriptionId: string | null;
  prescriptions: ExercisePrescription[];
  restBoundaries: { afterIndex: number; restMs: number }[];
  sessionTitle: string;
  patientProfile?: PatientProfile;
  patientName?: string;
  patientId?: string;
  previousSession?: { mobilityScore: number; sessionTitle: string; claudeSummary: string };
  error?: string;
}

// ─── Screens ──────────────────────────────────────────────────────────────────

function LoadingScreen({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <div style={{ fontSize: 32 }}>⚡</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#e6edf3" }}>AI Physio</div>
      <div style={{ fontSize: 14, color: "#7d8590" }}>{message}</div>
    </div>
  );
}

function ErrorScreen({ message, prescriptionId }: { message: string; prescriptionId: string | null }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
      padding: 32,
    }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#e6edf3" }}>Session Not Found</div>
      <div style={{ fontSize: 14, color: "#7d8590", maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
        {message}
      </div>
      {prescriptionId && (
        <div style={{ fontSize: 11, color: "#484f58", fontFamily: "monospace" }}>
          Prescription ID: {prescriptionId}
        </div>
      )}
      <a href="/admin" style={{
        marginTop: 8, padding: "8px 20px",
        background: "#388bfd", color: "#fff", borderRadius: 6,
        textDecoration: "none", fontSize: 13, fontWeight: 500,
      }}>
        ← Back to Admin
      </a>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SessionPageClient({
  prescriptionId,
  prescriptions,
  restBoundaries,
  sessionTitle,
  patientProfile,
  patientName,
  patientId,
  previousSession,
  error,
}: SessionPageClientProps) {
  // No prescription param — render SessionRunner in default library mode
  if (!prescriptionId) {
    return (
      <Suspense fallback={<LoadingScreen message="Loading session..." />}>
        <SessionRunner />
      </Suspense>
    );
  }

  if (error) {
    return <ErrorScreen message={error} prescriptionId={prescriptionId} />;
  }

  if (prescriptions.length === 0) {
    return (
      <ErrorScreen
        message={
          "None of the exercises in this session could be loaded. " +
          "Make sure exercise names match: right-arm-raise, left-arm-raise, both-arm-raise, sit-to-stand."
        }
        prescriptionId={prescriptionId}
      />
    );
  }

  return (
    <Suspense fallback={<LoadingScreen message="Loading session..." />}>
      <SessionRunner
        prescriptionQueue={prescriptions}
        restBoundaries={restBoundaries}
        sessionTitle={sessionTitle}
        initialPatientProfile={patientProfile}
        patientName={patientName}
        prescriptionId={prescriptionId}
        patientId={patientId}
        previousSession={previousSession}
      />
    </Suspense>
  );
}
