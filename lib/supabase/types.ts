// lib/supabase/types.ts
// Schema v3 — Module 11
// Reflects clinical naming, slug-based exercise lookup, and new patient/protocol fields.

export type PatientType = 'general_fitness' | 'post_surgery' | 'senior' | 'chronic_pain'
export type UserRole = 'physio' | 'patient' | 'clinic_admin' | 'super_admin'
export type ExerciseType =
  | 'shoulder_flexion'
  | 'shoulder_abduction'
  | 'sit_to_stand'
  | 'knee_extension'
  | 'knee_flexion'
  | 'custom'
export type PlaneOfMotion = 'sagittal' | 'frontal' | 'transverse'
export type Laterality = 'unilateral_right' | 'unilateral_left' | 'bilateral' | 'centre'
export type SessionStatus = 'pending' | 'in_progress' | 'completed' | 'missed' | 'cancelled'

// ─── Clinic ───────────────────────────────────────────────────────────────────
export interface Clinic {
  id: string; name: string; slug: string | null; address: string | null
  phone: string | null; email: string | null; timezone: string
  country_code: string; is_active: boolean; created_at: string; updated_at: string
}

// ─── Identity ─────────────────────────────────────────────────────────────────
export interface Profile {
  id: string; role: UserRole; full_name: string; created_at: string
}
export interface PhysioProfile {
  id: string; clinic_id: string | null; clinic_name: string | null
  license_number: string | null; created_at: string
  profile?: Profile; clinic?: Clinic
}

// ─── Patients ─────────────────────────────────────────────────────────────────
export interface Patient {
  id: string; clinic_id: string | null
  first_name: string; last_name: string; full_name: string
  patient_type: PatientType; date_of_birth: string | null
  height_cm: number | null; weight_kg: number | null
  photo_url: string | null; condition_notes: string | null
  goals: string | null; consent_given_at: string | null
  data_retention_until: string | null; created_at: string
  // Module 11: contact + PIPEDA consent
  email: string | null
  phone: string | null
  notification_consent: boolean
  notification_consent_at: string | null
  coaching_preferences: Record<string, unknown> | null
  clinic?: Clinic; physios?: PatientPhysio[]
}
export interface PatientPhysio {
  id: string; patient_id: string; physio_id: string; clinic_id: string
  is_primary: boolean; assigned_at: string; notes: string | null
  physio?: PhysioProfile
}

// ─── Exercise Library ─────────────────────────────────────────────────────────
export interface CoachingStrings {
  intro: string
  lift: string
  hold: string | string[]
  lower: string
  success_rotating: string[]
  correction_height: string
  correction_hold: string
  correction_balance: string
  correction_isolation?: string
}
export interface MeasurementSpec {
  primary_metric: string; threshold_degrees: number
  bilateral_check: boolean; symmetry_threshold_degrees?: number
  confidence_minimum: number; key_landmarks: string[]
}
export interface ExerciseTemplate {
  id: string; clinic_id: string | null; created_by: string | null
  is_vanilla: boolean
  // slug: stable programmatic key — never shown to users, used in buildPrescription() lookups
  slug: string
  // clinical_name: shown to physios in admin, protocols, clinical documentation
  clinical_name: string
  // display_name: shown to patients in session runner and voice coaching
  display_name: string
  exercise_type: ExerciseType
  plane_of_motion: PlaneOfMotion | null
  laterality: Laterality | null
  description: string | null
  clinical_objective: string | null
  default_reps: number
  default_hold_ms: number
  default_rest_ms: number
  target_metric_degrees: number
  bilateral: boolean
  coaching_strings: CoachingStrings
  measurement_spec: MeasurementSpec
  // Module 11: coaching customisation
  coaching_persona: string
  coaching_focus: string
  media_url: string | null
  created_at: string; updated_at: string
}

// ─── Protocols ────────────────────────────────────────────────────────────────
export interface Protocol {
  id: string; clinic_id: string | null; created_by: string | null
  title: string; objective: string | null
  estimated_duration_mins: number; tags: string[]
  // Module 11: session coaching context
  session_coaching_context: string | null
  created_at: string; updated_at: string
  exercises?: ProtocolExercise[]; clinic?: Clinic
}
export interface ProtocolExercise {
  id: string; protocol_id: string; exercise_template_id: string
  sequence_order: number; default_reps: number | null
  default_hold_ms: number | null
  // Module 11: rest after this exercise before the next
  rest_after_ms: number
  created_at: string
  exercise_template?: ExerciseTemplate
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
export interface Session {
  id: string; clinic_id: string | null; patient_id: string
  physio_id: string | null; source_protocol_id: string | null
  title: string; objective: string | null; scheduled_date: string | null
  estimated_duration_mins: number; status: SessionStatus
  created_at: string; updated_at: string
  patient?: Patient; physio?: PhysioProfile
  blocks?: SessionBlock[]; result?: SessionResult
}
export interface SessionBlock {
  id: string; session_id: string; protocol_id: string | null
  sequence_order: number; rest_before_ms: number
  title_override: string | null; notes: string | null; created_at: string
  protocol?: Protocol; exercises?: SessionBlockExercise[]
}
export interface SessionBlockExercise {
  id: string; session_block_id: string; exercise_template_id: string
  sequence_order: number; reps_override: number | null
  hold_ms_override: number | null; coaching_notes: string | null
  // Module 11: rest after this exercise before the next
  rest_after_ms: number
  created_at: string; exercise_template?: ExerciseTemplate
}

// ─── Backward compat ──────────────────────────────────────────────────────────
export interface PrescriptionExercise {
  id: string; prescription_id: string; template_id: string
  sequence_order: number; reps_override: number | null
  hold_ms_override: number | null; rest_ms_override: number | null
  coaching_notes: string | null; created_at: string
  template?: ExerciseTemplate
}

// ─── Session Results ──────────────────────────────────────────────────────────
export interface SessionResult {
  id: string; prescription_id: string | null
  patient_id: string | null; clinic_id: string | null
  started_at: string; completed_at: string | null
  duration_ms: number | null; mobility_score: number | null
  claude_summary: string | null; physio_reviewed: boolean
  physio_notes: string | null; created_at: string
  exercise_results?: ExerciseResult[]
}
export interface ExerciseResult {
  id: string; session_result_id: string
  session_block_id: string | null; protocol_block_order: number | null
  template_id: string | null; prescription_exercise_id: string | null
  sequence_order: number; reps_prescribed: number
  reps_attempted: number; reps_successful: number; reps_failed: number
  hold_compliance_rate: number | null; avg_hold_ms: number | null
  avg_metric_degrees: number | null; target_metric_degrees: number | null
  failed_hold_count: number; failed_height_count: number
  failed_balance_count: number; failed_isolation_count: number
  movement_timeline: object | null; created_at: string
}

// ─── Draft types for admin assign flow ───────────────────────────────────────
export interface SessionBlockDraft {
  protocol: Protocol; rest_before_ms: number
  title_override: string; notes: string
  exercise_overrides: {
    exercise_template_id: string; reps: number
    hold_ms: number; coaching_notes: string
  }[]
}
export interface SessionDraft {
  title: string; objective: string
  scheduled_date: string | null
  estimated_duration_mins: number
  blocks: SessionBlockDraft[]
}

export interface ExerciseTemplateFormData {
  slug: string
  clinical_name: string
  display_name: string
  description: string
  clinical_objective: string
  default_reps: number
  default_hold_ms: number
  default_rest_ms: number
  target_metric_degrees: number
  billing: boolean
  coaching_strings: CoachingStrings
}
