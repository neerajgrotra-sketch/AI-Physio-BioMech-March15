// app/session/page.tsx
// Server component — runs on the server for every request.
// Uses the Supabase service client (SUPABASE_SERVICE_ROLE_KEY) so that
// unauthenticated patients can load their session without hitting RLS.
// All data is fetched here and passed as plain props to SessionPageClient.
// No Supabase calls ever reach the browser.

import { getServiceClient } from '@/lib/supabase/serviceClient';
import SessionPageClient from './SessionPageClient';
import { buildPrescription } from '@/lib/sessions/buildSessionPrescription';
import type { ExercisePrescription } from '@/lib/types/exercise';
import type { PatientProfile, PatientType } from '@/lib/patient/patientTypes';

// ─── Next.js 14 server page props ────────────────────────────────────────────

interface PageProps {
  searchParams: { prescription?: string };
}

// ─── Supabase row shapes ──────────────────────────────────────────────────────

interface SupabaseSessionBlock {
  id: string;
  sequence_order: number;
  rest_before_ms: number;
  title_override: string | null;
  session_block_exercises: {
    sequence_order: number;
    reps_override: number | null;
    hold_ms_override: number | null;
    rom_target_degrees: number | null;
    rom_encourage_degrees: number | null;
    exercise_templates: {
      slug: string;
      display_name: string;
      default_reps: number;
      default_hold_ms: number;
      coaching_strings: Record<string, unknown>;
      rom_start_degrees: number | null;
      rom_norm_degrees: number | null;
      rom_acceptable_min: number | null;
    } | null;
  }[];
}

interface SupabasePrescriptionExercise {
  sequence_order: number;
  reps_override: number | null;
  hold_ms_override: number | null;
  exercise_templates: {
    slug: string;
    display_name: string;
    default_reps: number;
    default_hold_ms: number;
    coaching_strings: Record<string, unknown>;
    rom_start_degrees: number | null;
    rom_norm_degrees: number | null;
    rom_acceptable_min: number | null;
  } | null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function SessionPage({ searchParams }: PageProps) {
  const prescriptionId = searchParams.prescription ?? null;

  // No param — hand straight to client, renders SessionRunner in default mode
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

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('sessions')
    .select(`
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
          rom_target_degrees,
          rom_encourage_degrees,
          exercise_templates (
            slug,
            display_name,
            default_reps,
            default_hold_ms,
            coaching_strings,
            rom_start_degrees,
            rom_norm_degrees,
            rom_acceptable_min
          )
        )
      ),
      prescription_exercises (
        sequence_order,
        reps_override,
        hold_ms_override,
        exercise_templates (
          slug,
          display_name,
          default_reps,
          default_hold_ms,
          coaching_strings,
          rom_start_degrees,
          rom_norm_degrees,
          rom_acceptable_min
        )
      )
    `)
    .eq('id', prescriptionId)
    .single();

  if (error || !data) {
    return (
      <SessionPageClient
        prescriptionId={prescriptionId}
        prescriptions={[]}
        restBoundaries={[]}
        sessionTitle=""
        error={error?.message ?? 'Session not found. It may have been deleted.'}
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
      .from('patients')
      .select('full_name, patient_type, condition_notes')
      .eq('id', data.patient_id)
      .single();

    if (pt) {
      patientName = pt.full_name as string;
      const typeMap: Record<string, PatientType> = {
        general_fitness: 'general_fitness',
        post_surgery: 'post_surgery',
        senior: 'senior',
        chronic_pain: 'chronic_pain',
        elderly: 'senior',
        pediatric: 'general_fitness',
      };
      patientProfile = {
        type: typeMap[pt.patient_type as string] ?? 'general_fitness',
        sessionNumber: 1,
        isReturningPatient: false,
        clinicalNotes: (pt.condition_notes as string | null) ?? null,
      };
    }
  }

  // ── Fetch previous session for greeting ─────────────────────────────────
  let previousSession: { mobilityScore: number; sessionTitle: string; claudeSummary: string } | null = null;

  if (patientId) {
    const { data: prevResult } = await supabase
      .from('session_results')
      .select('mobility_score, claude_summary, prescription_id')
      .eq('patient_id', patientId)
      .not('claude_summary', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (prevResult) {
      // Get title of that session
      const { data: prevSession } = await supabase
        .from('sessions')
        .select('title')
        .eq('id', prevResult.prescription_id)
        .single();

      previousSession = {
        mobilityScore: prevResult.mobility_score ?? 0,
        sessionTitle: prevSession?.title ?? 'previous session',
        claudeSummary: (prevResult.claude_summary as string).slice(0, 400),
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
    for (const block of sortedBlocks) {
      const blockStart = mapped.length;
      if (block.sequence_order > 0 && block.rest_before_ms > 0) {
        boundaries.push({ afterIndex: blockStart - 1, restMs: block.rest_before_ms });
      }
      const blockExercises = [...block.session_block_exercises].sort(
        (a, b) => a.sequence_order - b.sequence_order
      );
      for (const ex of blockExercises) {
        const tmpl = ex.exercise_templates;
        if (!tmpl) continue;
        const reps = ex.reps_override ?? tmpl.default_reps;
        const holdMs = ex.hold_ms_override ?? tmpl.default_hold_ms;
        const prescription = buildPrescription(tmpl.slug, tmpl.display_name, reps, holdMs, tmpl.coaching_strings, tmpl.rom_start_degrees ?? null, tmpl.rom_norm_degrees ?? null, tmpl.rom_acceptable_min ?? null, ex.rom_target_degrees ?? null, ex.rom_encourage_degrees ?? null);
        if (prescription) mapped.push(prescription);
      }
    }
  } else {
    // Backward compat: flat prescription_exercises (pre-module-8)
    const exercises: SupabasePrescriptionExercise[] = (
      (data.prescription_exercises as unknown as SupabasePrescriptionExercise[]) ?? []
    ).sort((a, b) => a.sequence_order - b.sequence_order);

    for (const ex of exercises) {
      const tmpl = ex.exercise_templates;
      if (!tmpl) continue;
      const reps = ex.reps_override ?? tmpl.default_reps;
      const holdMs = ex.hold_ms_override ?? tmpl.default_hold_ms;
      const prescription = buildPrescription(tmpl.slug, tmpl.display_name, reps, holdMs, tmpl.coaching_strings, tmpl.rom_start_degrees ?? null, tmpl.rom_norm_degrees ?? null, tmpl.rom_acceptable_min ?? null);
      if (prescription) mapped.push(prescription);
    }
  }

  return (
    <SessionPageClient
      prescriptionId={prescriptionId}
      prescriptions={mapped}
      restBoundaries={boundaries}
      sessionTitle={data.title}
      patientProfile={patientProfile}
      patientName={patientName}
      patientId={patientId}
      previousSession={previousSession ?? undefined}
    />
  );
}
