// lib/supabase/types.ts
// TypeScript types that mirror the Supabase schema

export type UserRole = 'physio' | 'patient'
export type PatientType = 'general_fitness' | 'post_surgery' | 'elderly' | 'pediatric'
export type ExerciseType = 'arm_raise' | 'bilateral_arm_raise' | 'sit_to_stand' | 'custom'
export type PrescriptionStatus = 'pending' | 'in_progress' | 'completed' | 'missed' | 'cancelled'

// ─── Profiles ────────────────────────────────────────────────────────────────

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  created_at: string
}

export interface PhysioProfile {
  id: string
  clinic_name: string | null
  license_number: string | null
  created_at: string
}

export interface PatientProfile {
  id: string
  physio_id: string | null
  date_of_birth: string | null
  patient_type: PatientType
  condition_notes: string | null
  goals: string | null
  consent_given_at: string | null
  consent_version: string | null
  data_retention_until: string | null
  created_at: string
  // Joined
  profile?: Profile
}

// ─── Exercise Library ─────────────────────────────────────────────────────────

export interface CoachingStrings {
  intro: string
  hold: string[]
  lower: string
  success_first: string
  success_rotating: string[]
  correction_height: string
  correction_hold: string
  correction_balance: string
  correction_isolation: string
  exercise_complete: string
}

export interface MeasurementSpec {
  primary_metric: string
  threshold_degrees: number
  bilateral_check: boolean
  symmetry_threshold_degrees?: number
  confidence_minimum: number
  key_landmarks: string[]
}

export interface ExerciseTemplate {
  id: string
  created_by: string | null
  is_vanilla: boolean
  name: string
  display_name: string
  exercise_type: ExerciseType
  description: string | null
  clinical_objective: string | null
  default_reps: number
  default_hold_ms: number
  default_rest_ms: number
  target_metric_degrees: number
  bilateral: boolean
  coaching_strings: CoachingStrings
  measurement_spec: MeasurementSpec
  created_at: string
  updated_at: string
}

// ─── Session Prescriptions ────────────────────────────────────────────────────

export interface SessionPrescription {
  id: string
  physio_id: string
  patient_id: string
  title: string
  objective: string | null
  due_date: string | null
  estimated_duration_mins: number
  status: PrescriptionStatus
  created_at: string
  updated_at: string
  // Joined
  exercises?: PrescriptionExercise[]
  patient?: PatientProfile & { profile?: Profile }
}

export interface PrescriptionExercise {
  id: string
  prescription_id: string
  template_id: string
  sequence_order: number
  reps_override: number | null
  hold_ms_override: number | null
  rest_ms_override: number | null
  coaching_notes: string | null
  created_at: string
  // Joined
  template?: ExerciseTemplate
}

// ─── Session Results ──────────────────────────────────────────────────────────

export interface SessionResult {
  id: string
  prescription_id: string | null
  patient_id: string
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  mobility_score: number | null
  claude_summary: string | null
  physio_reviewed: boolean
  physio_notes: string | null
  created_at: string
  // Joined
  exercise_results?: ExerciseResult[]
}

export interface ExerciseResult {
  id: string
  session_result_id: string
  template_id: string | null
  prescription_exercise_id: string | null
  sequence_order: number
  reps_prescribed: number
  reps_attempted: number
  reps_successful: number
  reps_failed: number
  hold_compliance_rate: number | null
  avg_hold_ms: number | null
  avg_metric_degrees: number | null
  target_metric_degrees: number | null
  failed_hold_count: number
  failed_height_count: number
  failed_balance_count: number
  failed_isolation_count: number
  movement_timeline: object | null
  created_at: string
}

// ─── Computed / Display types ─────────────────────────────────────────────────

export interface ExerciseTemplateFormData {
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
