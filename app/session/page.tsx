// app/session/page.tsx
// Server component — runs on the server for every request.
// Uses the Supabase service client (SUPABASE_SERVICE_ROLE_KEY) so that
// unauthenticated patients can load their session without hitting RLS.
// All data is fetched here and passed as plain props to SessionPageClient.
// No Supabase calls ever reach the browser.

import { getServiceClient } from '@/lib/supabase/serviceClient';
import SessionPageClient from './SessionPageClient';
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

// ─── Prescription builder ─────────────────────────────────────────────────────
// Keyed on exercise_templates.slug (snake_case, e.g. shoulder_flexion_right).
// display_name from the DB is passed through as the patient-facing exercise name.
// clinical_name is used server-side only and not needed in the prescription payload.

function buildPrescription(
  slug: string,
  displayName: string,
  repOverride: number,
  holdMsOverride: number,
  coachingStrings: Record<string, unknown>,
  romStart: number | null = null,
  romNorm: number | null = null,
  romAcceptableMin: number | null = null,
): ExercisePrescription | null {
  const hold = {
    required: holdMsOverride > 0,
    durationMs: holdMsOverride,
  };

  // ── ROM-driven thresholds ──────────────────────────────────────────────────
  // Derived from DB values so every exercise uses clinically correct targets.
  // startThreshold:  just above rest position — triggers rep detection
  // targetThreshold: minimum degrees for a rep to count (rom_acceptable_min)
  // finishThreshold: back near rest — ends the rep cycle
  // targetValue:     the prescribed goal (rom_norm_degrees) — used by ghost + AI
  //
  // For descending metrics (knee extension: 90° → 0°), values invert in the
  // interpreter — we pass the DB values as-is and let the state machine handle it.
  const _romStart = romStart ?? 0;
  const _romNorm = romNorm ?? 160;
  const _romMin = romAcceptableMin ?? 110;
  const startThresh = _romStart + 15;
  const targetThresh = _romMin;
  const finishThresh = _romStart + 20;

  const coaching = {
    intro: (coachingStrings.intro as string) ?? 'Begin when ready.',
    lift: (coachingStrings.lift as string) ?? 'Lift to the target position.',
    hold: Array.isArray(coachingStrings.hold)
      ? (coachingStrings.hold as string[])[0] ?? 'Hold at the top.'
      : (coachingStrings.hold as string) ?? 'Hold at the top.',
    lower: (coachingStrings.lower as string) ?? 'Lower slowly.',
    success: Array.isArray(coachingStrings.success_rotating)
      ? (coachingStrings.success_rotating as string[])[0] ?? 'Good.'
      : 'Good.',
    failedHeight:
      (coachingStrings.correction_height as string) ?? 'Lift a little higher.',
    failedHold:
      (coachingStrings.correction_hold as string) ?? 'Hold for the full duration.',
    failedBalance:
      (coachingStrings.correction_balance as string) ?? 'Keep your posture steady.',
    failedIsolation:
      (coachingStrings.correction_isolation as string) ?? undefined,
  };

  switch (slug) {
    // ── Shoulder Flexion (sagittal plane — arm forward and up) ───────────────
    case 'shoulder_flexion_right':
      return {
        id: 'shoulder_flexion_right',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'right',
        posture: 'either',
        description: 'Lift your right arm forward and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'rightArmElevationDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 10 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15, maxOppositeArmElevationDeg: 35 },
        coaching,
        framing: {
          intent: 'Measure right arm elevation arc in the sagittal plane from resting to shoulder height.',
          landmarks: { critical: ['right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['left_shoulder', 'nose', 'right_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Lateral or frontal view. Ensure the right arm and shoulder are clearly visible.',
          measurementRisk: 'Without clear visibility of right arm landmarks, elevation cannot be measured accurately.',
        },
      };

    case 'shoulder_flexion_left':
      return {
        id: 'shoulder_flexion_left',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'left',
        posture: 'either',
        description: 'Lift your left arm forward and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'leftArmElevationDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 10 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15, maxOppositeArmElevationDeg: 35 },
        coaching,
        framing: {
          intent: 'Measure left arm elevation arc in the sagittal plane from resting to shoulder height.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist'], supporting: ['right_shoulder', 'nose', 'left_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Lateral or frontal view. Ensure the left arm and shoulder are clearly visible.',
          measurementRisk: 'Without clear visibility of left arm landmarks, elevation cannot be measured accurately.',
        },
      };

    case 'shoulder_flexion_bilateral':
      return {
        id: 'shoulder_flexion_bilateral',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'both',
        posture: 'either',
        description: 'Lift both arms forward and up to shoulder height simultaneously, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'bilateralArmElevationDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 10 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15 },
        coaching,
        framing: {
          intent: 'Measure bilateral arm elevation simultaneously in the sagittal plane.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['nose', 'left_hip', 'right_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: true,
          angleGuidance: 'Frontal view required. Patient must be centred with both arms fully visible.',
          measurementRisk: 'Without bilateral landmark visibility, asymmetry cannot be detected.',
        },
      };

    // ── Shoulder Abduction (frontal plane — arm out to the side and up) ──────
    case 'shoulder_abduction_right':
      return {
        id: 'shoulder_abduction_right',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'right',
        posture: 'either',
        description: 'Lift your right arm out to the side and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'rightArmAbductionDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 15, maxShoulderTiltDeg: 12, maxOppositeArmElevationDeg: 30 },
        coaching,
        framing: {
          intent: 'Measure right arm abduction arc in the frontal plane from resting to 90 degrees.',
          landmarks: { critical: ['right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['left_shoulder', 'right_hip', 'nose'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Frontal view essential. Patient must face the camera directly for accurate abduction measurement.',
          measurementRisk: 'Lateral camera angle will misrepresent frontal plane abduction. Frontal view required.',
        },
      };

    case 'shoulder_abduction_left':
      return {
        id: 'shoulder_abduction_left',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'left',
        posture: 'either',
        description: 'Lift your left arm out to the side and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'leftArmAbductionDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 15, maxShoulderTiltDeg: 12, maxOppositeArmElevationDeg: 30 },
        coaching,
        framing: {
          intent: 'Measure left arm abduction arc in the frontal plane from resting to 90 degrees.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist'], supporting: ['right_shoulder', 'left_hip', 'nose'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Frontal view essential. Patient must face the camera directly for accurate abduction measurement.',
          measurementRisk: 'Lateral camera angle will misrepresent frontal plane abduction. Frontal view required.',
        },
      };

    case 'shoulder_abduction_bilateral':
      return {
        id: 'shoulder_abduction_bilateral',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'both',
        posture: 'either',
        description: 'Lift both arms out to the sides simultaneously to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'bilateralArmAbductionDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 15, maxShoulderTiltDeg: 12 },
        coaching,
        framing: {
          intent: 'Measure bilateral arm abduction simultaneously in the frontal plane.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['nose', 'left_hip', 'right_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: true,
          angleGuidance: 'Frontal view required. Patient must be centred with both arms fully visible.',
          measurementRisk: 'Without bilateral landmark visibility, asymmetry cannot be detected.',
        },
      };

    // ── Sit to Stand (sagittal plane — transfer) ──────────────────────────────
    case 'sit_to_stand':
      return {
        id: 'sit_to_stand',
        name: displayName,
        category: 'transfer',
        template: 'rise_hold_lower',
        runtimeStatus: 'active',
        side: 'center',
        posture: 'seated',
        description: 'Rise to standing from seated, hold at full extension, then sit back down with control.',
        repTarget: repOverride,
        startThreshold: 100,
        targetThreshold: 170,
        finishThreshold: 120,
        target: { metric: 'kneeToHipExtensionScore', label: 'full standing', targetValue: 170, tolerance: 10 },
        hold: { required: holdMsOverride > 0, durationMs: holdMsOverride || 1000 },
        tempo: { label: 'slow and controlled' },
        coaching,
        framing: {
          intent: 'Detect hip transition from seated to full standing. Hip and knee landmarks must be visible throughout.',
          landmarks: { critical: ['left_hip', 'right_hip', 'left_knee', 'right_knee'], supporting: ['left_shoulder', 'right_shoulder', 'left_ankle', 'right_ankle'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'full_body',
          peakMovementZone: 'standing_full',
          requiredStartPosture: 'seated',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Side or frontal view. Full body must be visible from head to feet.',
          measurementRisk: 'Without hip and knee visibility, standing position cannot be confirmed.',
        },
      };

    // ── Knee Extension (sagittal plane — seated) ──────────────────────────────
    case 'knee_extension_right':
      return {
        id: 'knee_extension_right',
        name: displayName,
        category: 'lower_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'right',
        posture: 'seated',
        description: 'Seated: straighten your right knee fully, hold at full extension, then lower slowly.',
        repTarget: repOverride,
        startThreshold: 60,
        targetThreshold: 155,
        finishThreshold: 80,
        target: { metric: 'rightKneeExtensionDeg', label: 'full extension', targetValue: 170, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 20 },
        coaching,
        framing: {
          intent: 'Measure right knee extension arc from seated flexion to full extension.',
          landmarks: { critical: ['right_hip', 'right_knee', 'right_ankle'], supporting: ['left_hip', 'left_knee', 'right_shoulder'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'lower_body',
          peakMovementZone: 'knee_extension',
          requiredStartPosture: 'seated',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Side view preferred. Right leg must be fully visible from hip to ankle.',
          measurementRisk: 'Without visibility of right knee and ankle, extension cannot be measured.',
        },
      };

    default:
      console.warn(`Unknown exercise slug: "${slug}" — skipping.`);
      return null;
  }
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
        const prescription = buildPrescription(tmpl.slug, tmpl.display_name, reps, holdMs, tmpl.coaching_strings, tmpl.rom_start_degrees ?? null, tmpl.rom_norm_degrees ?? null, tmpl.rom_acceptable_min ?? null);
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
    />
  );
}
