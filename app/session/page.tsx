// app/session/page.tsx
// Server component — runs on the server for every request.
// Uses the Supabase service client (SUPABASE_SERVICE_ROLE_KEY) so that
// unauthenticated patients can load their session without hitting RLS.
//
// All data is fetched here, mapped to ExercisePrescription[], and passed
// as plain serialisable props to SessionPageClient (the 'use client' shell).
// No Supabase calls ever reach the browser.

import { getServiceClient } from "@/lib/supabase/serviceClient";
import SessionPageClient from "./SessionPageClient";
import {
  buildPrescription,
  SupabaseSessionBlock,
  SupabasePrescriptionExercise,
} from "@/lib/session/buildPrescription";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { PatientProfile, PatientType } from "@/lib/patient/patientTypes";

// Next.js 14 server page receives searchParams as a plain object prop.
// No need for useSearchParams() here — this runs on the server.
interface PageProps {
  searchParams: { prescription?: string };
}

export default async function SessionPage({ searchParams }: PageProps) {
  const prescriptionId = searchParams.prescription ?? null;

  // No param — hand straight to client, which renders SessionRunner in default mode
  if (!prescriptionId) {
    return (
      <SessionPageClient
        prescriptionId={null}
        prescriptions={[]}
        restBoundaries={[]}
        sessionTitle=""
      />
    );
  }

  // ── Fetch session data server-side using service client ──────────────────
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("sessions")
    .select(
      `
      id,
      title,
      objective,
      patient_id,
      session_blocks (
        id,
        sequence_order,
        rest_before_ms,
        title_override,
        session_block_exercises (
          sequence_order,
          reps_override,
          hold_ms_override,
          exercise_templates (
            name,
            display_name,
            default_reps,
            default_hold_ms,
            coaching_strings
          )
        )
      ),
      prescription_exercises (
        sequence_order,
        reps_override,
        hold_ms_override,
        exercise_templates (
          name,
          display_name,
          default_reps,
          default_hold_ms,
          coaching_strings
        )
      )
    `
    )
    .eq("id", prescriptionId)
    .single();

  if (error || !data) {
    return (
      <SessionPageClient
        prescriptionId={prescriptionId}
        prescriptions={[]}
        restBoundaries={[]}
        sessionTitle=""
        error={error?.message ?? "Session not found. It may have been deleted."}
      />
    );
  }

  // ── Fetch patient record ─────────────────────────────────────────────────
  let patientProfile: PatientProfile | undefined;
  let patientName: string | undefined;
  let patientId: string | undefined;

  if (data.patient_id) {
    patientId = data.patient_id;

    const { data: pt } = await supabase
      .from("patients")
      .select("full_name, patient_type, condition_notes")
      .eq("id", data.patient_id)
      .single();

    if (pt) {
      patientName = pt.full_name as string;

      const typeMap: Record<string, PatientType> = {
        general_fitness: "general_fitness",
        post_surgery: "post_surgery",
        senior: "senior",
        chronic_pain: "chronic_pain",
        elderly: "senior",
        pediatric: "general_fitness",
      };

      patientProfile = {
        type: typeMap[pt.patient_type as string] ?? "general_fitness",
        sessionNumber: 1,
        isReturningPatient: false,
        clinicalNotes: (pt.condition_notes as string | null) ?? null,
      };
    }
  }

  // ── Map DB rows → ExercisePrescription[] ────────────────────────────────
  const mapped: ExercisePrescription[] = [];
  const boundaries: { afterIndex: number; restMs: number }[] = [];

  const blocks =
    (data.session_blocks as unknown as SupabaseSessionBlock[] | null) ?? [];
  const sortedBlocks = [...blocks].sort(
    (a, b) => a.sequence_order - b.sequence_order
  );

  if (sortedBlocks.length > 0) {
    // New path: session_blocks → session_block_exercises (module 8+)
    for (const block of sortedBlocks) {
      const blockStart = mapped.length;

      if (block.sequence_order > 0 && block.rest_before_ms > 0) {
        boundaries.push({
          afterIndex: blockStart - 1,
          restMs: block.rest_before_ms,
        });
      }

      const blockExercises = [...block.session_block_exercises].sort(
        (a, b) => a.sequence_order - b.sequence_order
      );

      for (const ex of blockExercises) {
        const tmpl = ex.exercise_templates;
        if (!tmpl) continue;
        const reps = ex.reps_override ?? tmpl.default_reps;
        const holdMs = ex.hold_ms_override ?? tmpl.default_hold_ms;
        const prescription = buildPrescription(
          tmpl.name,
          reps,
          holdMs,
          tmpl.coaching_strings
        );
        if (prescription) mapped.push(prescription);
      }
    }
  } else {
    // Backward compat: flat prescription_exercises (pre-module-8)
    const exercises: SupabasePrescriptionExercise[] = (
      (data.prescription_exercises as unknown as SupabasePrescriptionExercise[]) ??
      []
    ).sort((a, b) => a.sequence_order - b.sequence_order);

    for (const ex of exercises) {
      const tmpl = ex.exercise_templates;
      if (!tmpl) continue;
      const reps = ex.reps_override ?? tmpl.default_reps;
      const holdMs = ex.hold_ms_override ?? tmpl.default_hold_ms;
      const prescription = buildPrescription(
        tmpl.name,
        reps,
        holdMs,
        tmpl.coaching_strings
      );
      if (prescription) mapped.push(prescription);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SessionPageClient
      prescriptionId={prescriptionId}
      prescriptions={mapped}
      restBoundaries={boundaries}
      sessionTitle={data.title}
      patientProfile={patientProfile}
      patientName={patientName}
      patientId={patientId}
    />
  );
}
