-- ============================================================
-- Baseline schema for the ai-physio-v2 Supabase project
-- ============================================================
-- Generated on 2026-11-25 from the LIVE database (project ref
-- vuigpzdykfzmcutyfcqx), because most of the schema had been
-- created by hand in the SQL editor and was never saved here.
--
-- This one file recreates the whole public schema: tables,
-- constraints, indexes, functions, triggers, row level security
-- and policies. It already includes the three migrations the
-- live project lists (add_required_coverage_to_exercise_templates,
-- create_session_debug_logs, fix_session_debug_logs_rls).
--
-- Do NOT run this against the live project (it already has all of
-- this). Use it to build a fresh project or a local database.
-- From now on, every schema change goes in a new, dated file in
-- this folder, and is applied with that file.
-- ============================================================

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

-- ── Tables ──────────────────────────────────────────────────

create table if not exists public.clinics (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  slug text,
  address text,
  phone text,
  email text,
  timezone text default 'America/Toronto'::text not null,
  country_code text default 'CA'::text not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.profiles (
  id uuid not null,
  role text not null,
  full_name text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.physio_profiles (
  id uuid not null,
  clinic_id uuid,
  clinic_name text,
  license_number text,
  created_at timestamp with time zone default now()
);

-- Deprecated: patients live in public.patients. Kept because it still exists.
create table if not exists public.patient_profiles (
  id uuid not null,
  clinic_id uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.patients (
  id uuid default uuid_generate_v4() not null,
  clinic_id uuid,
  first_name text not null,
  last_name text not null,
  full_name text not null,
  patient_type text default 'general_fitness'::text not null,
  date_of_birth date,
  height_cm double precision,
  weight_kg double precision,
  photo_url text,
  condition_notes text,
  goals text,
  consent_given_at timestamp with time zone,
  data_retention_until date,
  created_at timestamp with time zone default now(),
  email text,
  phone text,
  notification_consent boolean default false,
  notification_consent_at timestamp with time zone,
  coaching_preferences jsonb
);

create table if not exists public.patient_physios (
  id uuid default uuid_generate_v4() not null,
  patient_id uuid,
  physio_id uuid,
  clinic_id uuid,
  is_primary boolean default false not null,
  assigned_at timestamp with time zone default now(),
  notes text
);

create table if not exists public.exercise_templates (
  id uuid default uuid_generate_v4() not null,
  clinic_id uuid,
  created_by uuid,
  is_vanilla boolean default false not null,
  slug text not null,
  display_name text not null,
  exercise_type text not null,
  description text,
  clinical_objective text,
  default_reps integer default 6 not null,
  default_hold_ms integer default 2000 not null,
  default_rest_ms integer default 1000 not null,
  target_metric_degrees double precision default 70.0 not null,
  bilateral boolean default false not null,
  coaching_strings jsonb default '{"hold": ["Hold it there.", "Hold there.", "Stay there.", "Good, hold.", "Keep it up."], "intro": "Perform the exercise as instructed.", "lower": "Lower slowly.", "success_first": "Good work.", "correction_hold": "Hold for the full duration.", "success_rotating": ["Good.", "That is it.", "Well done."], "correction_height": "Lift a little higher.", "exercise_complete": "Good work on that set.", "correction_balance": "Keep your posture steady.", "correction_isolation": "Keep the movement controlled."}'::jsonb not null,
  measurement_spec jsonb default '{"key_landmarks": ["right_shoulder", "right_elbow", "right_wrist"], "primary_metric": "arm_elevation_angle", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  clinical_name text not null,
  plane_of_motion text,
  laterality text,
  coaching_persona text default 'encouraging'::text,
  coaching_focus text default 'balanced'::text,
  media_url text,
  rom_start_degrees integer default 0,
  rom_norm_degrees integer,
  rom_max_degrees integer,
  patient_position text default 'standing'::text not null,
  camera_position text default 'front'::text not null,
  rom_unit text default 'degrees'::text not null,
  rom_acceptable_min integer default 110 not null,
  required_coverage text default 'upper_body'::text not null
);

create table if not exists public.exercise_phases (
  id uuid default uuid_generate_v4() not null,
  exercise_type text not null,
  phase_key text not null,
  phase_label text not null,
  phase_category text not null,
  sequence_order integer,
  rom_pct_enter double precision,
  rom_pct_exit double precision,
  velocity_threshold double precision,
  sustained_ms integer default 200 not null,
  fault_condition text,
  fault_severity text,
  is_system boolean default true not null,
  is_active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.phase_coaching_scripts (
  id uuid default uuid_generate_v4() not null,
  exercise_phase_id uuid,
  clinic_id uuid,
  trigger_event text not null,
  trigger_cooldown_ms integer default 8000 not null,
  once_per_rep boolean default true not null,
  cue_type text not null,
  patient_tone text not null,
  key_instruction text not null,
  correction_focus text,
  max_words integer default 12 not null,
  use_patient_name boolean default false not null,
  allow_variation boolean default true not null,
  variant_post_surgery text,
  variant_senior text,
  variant_general text,
  times_delivered integer default 0 not null,
  positive_outcome_rate double precision,
  last_tuned_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table if not exists public.protocols (
  id uuid default uuid_generate_v4() not null,
  clinic_id uuid,
  created_by uuid,
  title text not null,
  objective text,
  estimated_duration_mins integer default 10 not null,
  tags text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  session_coaching_context text
);

create table if not exists public.protocol_exercises (
  id uuid default uuid_generate_v4() not null,
  protocol_id uuid,
  exercise_template_id uuid,
  sequence_order integer default 0 not null,
  default_reps integer,
  default_hold_ms integer,
  created_at timestamp with time zone default now(),
  rest_after_ms integer default 0,
  rom_target_degrees integer
);

create table if not exists public.sessions (
  id uuid default uuid_generate_v4() not null,
  clinic_id uuid,
  patient_id uuid,
  physio_id uuid,
  source_protocol_id uuid,
  title text not null,
  objective text,
  scheduled_date date,
  estimated_duration_mins integer default 10 not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.session_blocks (
  id uuid default uuid_generate_v4() not null,
  session_id uuid,
  protocol_id uuid,
  sequence_order integer default 0 not null,
  rest_before_ms integer default 0 not null,
  title_override text,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.session_block_exercises (
  id uuid default uuid_generate_v4() not null,
  session_block_id uuid,
  exercise_template_id uuid,
  sequence_order integer default 0 not null,
  reps_override integer,
  hold_ms_override integer,
  coaching_notes text,
  created_at timestamp with time zone default now(),
  rest_after_ms integer default 0,
  rom_target_degrees integer,
  rom_encourage_degrees integer
);

-- Backward compat: pre-module-8 sessions. New sessions use session_blocks.
create table if not exists public.prescription_exercises (
  id uuid default uuid_generate_v4() not null,
  prescription_id uuid,
  template_id uuid,
  sequence_order integer default 0 not null,
  reps_override integer,
  hold_ms_override integer,
  rest_ms_override integer,
  coaching_notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.session_results (
  id uuid default uuid_generate_v4() not null,
  prescription_id uuid,
  patient_id uuid,
  clinic_id uuid,
  started_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  duration_ms integer,
  mobility_score double precision,
  claude_summary text,
  physio_reviewed boolean default false not null,
  physio_notes text,
  created_at timestamp with time zone default now(),
  summary_clinical text,
  summary_patient text,
  summary_generated_at timestamp with time zone,
  avg_rom_achieved_pct double precision,
  fault_frequency jsonb default '{}'::jsonb,
  hold_compliance_rate double precision,
  session_quality_score double precision
);

create table if not exists public.exercise_results (
  id uuid default uuid_generate_v4() not null,
  session_result_id uuid,
  session_block_id uuid,
  protocol_block_order integer,
  template_id uuid,
  prescription_exercise_id uuid,
  sequence_order integer default 0 not null,
  reps_prescribed integer default 0 not null,
  reps_attempted integer default 0 not null,
  reps_successful integer default 0 not null,
  reps_failed integer default 0 not null,
  hold_compliance_rate double precision,
  avg_hold_ms double precision,
  avg_metric_degrees double precision,
  target_metric_degrees double precision,
  failed_hold_count integer default 0 not null,
  failed_height_count integer default 0 not null,
  failed_balance_count integer default 0 not null,
  failed_isolation_count integer default 0 not null,
  movement_timeline jsonb,
  created_at timestamp with time zone default now(),
  landmark_confidence_pct double precision
);

create table if not exists public.patient_continuity_cache (
  id uuid default uuid_generate_v4() not null,
  patient_id uuid,
  session_id uuid,
  generated_at timestamp with time zone default now() not null,
  greeting_text text not null,
  progress_delta jsonb default '{}'::jsonb,
  is_first_session boolean default false not null,
  used_at timestamp with time zone
);

create table if not exists public.session_debug_logs (
  id uuid default uuid_generate_v4() not null,
  session_id uuid,
  clinic_id uuid,
  patient_id uuid,
  captured_at timestamp with time zone default now() not null,
  flush_reason text default 'session_end'::text not null,
  log_entries jsonb default '[]'::jsonb not null,
  framing_entries jsonb default '[]'::jsonb not null,
  exercise_count integer,
  total_entries integer,
  has_prereq_failures boolean generated always as (((framing_entries)::text ~~* '%PREREQ BLOCKED%'::text)) stored,
  has_framing_warnings boolean generated always as (((framing_entries)::text ~~* '%warning%'::text)) stored
);

-- ── Primary keys ────────────────────────────────────────────

alter table public.clinics add constraint clinics_pkey PRIMARY KEY (id);
alter table public.exercise_phases add constraint exercise_phases_pkey PRIMARY KEY (id);
alter table public.exercise_results add constraint exercise_results_pkey PRIMARY KEY (id);
alter table public.exercise_templates add constraint exercise_templates_pkey PRIMARY KEY (id);
alter table public.patient_continuity_cache add constraint patient_continuity_cache_pkey PRIMARY KEY (id);
alter table public.patient_physios add constraint patient_physios_pkey PRIMARY KEY (id);
alter table public.patient_profiles add constraint patient_profiles_pkey PRIMARY KEY (id);
alter table public.patients add constraint patients_pkey PRIMARY KEY (id);
alter table public.phase_coaching_scripts add constraint phase_coaching_scripts_pkey PRIMARY KEY (id);
alter table public.physio_profiles add constraint physio_profiles_pkey PRIMARY KEY (id);
alter table public.prescription_exercises add constraint prescription_exercises_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.protocol_exercises add constraint protocol_exercises_pkey PRIMARY KEY (id);
alter table public.protocols add constraint protocols_pkey PRIMARY KEY (id);
alter table public.session_block_exercises add constraint session_block_exercises_pkey PRIMARY KEY (id);
alter table public.session_blocks add constraint session_blocks_pkey PRIMARY KEY (id);
alter table public.session_debug_logs add constraint session_debug_logs_pkey PRIMARY KEY (id);
alter table public.session_results add constraint session_results_pkey PRIMARY KEY (id);
alter table public.sessions add constraint sessions_pkey PRIMARY KEY (id);

-- ── Unique and check constraints ────────────────────────────

alter table public.clinics add constraint clinics_slug_key UNIQUE (slug);
alter table public.exercise_phases add constraint exercise_phases_fault_severity_check CHECK ((fault_severity = ANY (ARRAY['advisory'::text, 'corrective'::text, 'critical'::text])));
alter table public.exercise_phases add constraint exercise_phases_phase_category_check CHECK ((phase_category = ANY (ARRAY['movement'::text, 'hold'::text, 'fault'::text, 'transition'::text, 'rest'::text])));
alter table public.exercise_phases add constraint exercise_phases_type_key_unique UNIQUE (exercise_type, phase_key);
alter table public.exercise_templates add constraint exercise_templates_camera_position_check CHECK ((camera_position = ANY (ARRAY['front'::text, 'side'::text, 'either'::text])));
alter table public.exercise_templates add constraint exercise_templates_exercise_type_check CHECK ((exercise_type = ANY (ARRAY['shoulder_flexion'::text, 'shoulder_abduction'::text, 'sit_to_stand'::text, 'knee_extension'::text, 'knee_flexion'::text, 'custom'::text])));
alter table public.exercise_templates add constraint exercise_templates_patient_position_check CHECK ((patient_position = ANY (ARRAY['standing'::text, 'seated'::text, 'either'::text])));
alter table public.exercise_templates add constraint exercise_templates_required_coverage_check CHECK ((required_coverage = ANY (ARRAY['upper_body'::text, 'torso_and_hips'::text, 'full_body'::text])));
alter table public.exercise_templates add constraint exercise_templates_rom_unit_check CHECK ((rom_unit = ANY (ARRAY['degrees'::text, 'normalised'::text])));
alter table public.patient_continuity_cache add constraint patient_continuity_cache_session_unique UNIQUE (session_id);
alter table public.patient_physios add constraint patient_physios_patient_id_physio_id_key UNIQUE (patient_id, physio_id);
alter table public.patients add constraint patients_patient_type_check CHECK ((patient_type = ANY (ARRAY['general_fitness'::text, 'post_surgery'::text, 'senior'::text, 'chronic_pain'::text])));
alter table public.phase_coaching_scripts add constraint phase_coaching_scripts_cue_type_check CHECK ((cue_type = ANY (ARRAY['movement_initiation'::text, 'movement_guidance'::text, 'position_correction'::text, 'compensation_correction'::text, 'hold_encouragement'::text, 'rep_affirmation'::text, 'set_completion'::text, 'safety_stop'::text])));
alter table public.phase_coaching_scripts add constraint phase_coaching_scripts_patient_tone_check CHECK ((patient_tone = ANY (ARRAY['encouraging'::text, 'calm_corrective'::text, 'motivational'::text, 'informational'::text, 'urgent'::text])));
alter table public.phase_coaching_scripts add constraint phase_coaching_scripts_trigger_event_check CHECK ((trigger_event = ANY (ARRAY['phase_enter'::text, 'phase_sustained'::text, 'fault_detected'::text, 'rep_complete'::text, 'set_complete'::text, 'hold_achieved'::text])));
alter table public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['physio'::text, 'patient'::text, 'clinic_admin'::text, 'super_admin'::text])));
alter table public.session_debug_logs add constraint session_debug_logs_flush_reason_check CHECK ((flush_reason = ANY (ARRAY['session_end'::text, 'pause'::text, 'error'::text, 'manual'::text])));
alter table public.session_results add constraint session_results_mobility_score_check CHECK (((mobility_score >= (0)::double precision) AND (mobility_score <= (100)::double precision)));
alter table public.sessions add constraint sessions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'missed'::text, 'cancelled'::text])));

-- ── Foreign keys ────────────────────────────────────────────

alter table public.exercise_phases add constraint exercise_phases_created_by_fkey FOREIGN KEY (created_by) REFERENCES physio_profiles(id) ON DELETE SET NULL;
alter table public.exercise_results add constraint exercise_results_session_block_id_fkey FOREIGN KEY (session_block_id) REFERENCES session_blocks(id) ON DELETE SET NULL;
alter table public.exercise_results add constraint exercise_results_session_result_id_fkey FOREIGN KEY (session_result_id) REFERENCES session_results(id) ON DELETE CASCADE;
alter table public.exercise_results add constraint exercise_results_template_id_fkey FOREIGN KEY (template_id) REFERENCES exercise_templates(id) ON DELETE SET NULL;
alter table public.exercise_templates add constraint exercise_templates_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.exercise_templates add constraint exercise_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES physio_profiles(id) ON DELETE SET NULL;
alter table public.patient_continuity_cache add constraint patient_continuity_cache_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
alter table public.patient_continuity_cache add constraint patient_continuity_cache_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.patient_physios add constraint patient_physios_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
alter table public.patient_physios add constraint patient_physios_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
alter table public.patient_physios add constraint patient_physios_physio_id_fkey FOREIGN KEY (physio_id) REFERENCES physio_profiles(id) ON DELETE CASCADE;
alter table public.patient_profiles add constraint patient_profiles_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.patient_profiles add constraint patient_profiles_id_fkey FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.patients add constraint patients_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.phase_coaching_scripts add constraint phase_coaching_scripts_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.phase_coaching_scripts add constraint phase_coaching_scripts_exercise_phase_id_fkey FOREIGN KEY (exercise_phase_id) REFERENCES exercise_phases(id) ON DELETE CASCADE;
alter table public.physio_profiles add constraint physio_profiles_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.physio_profiles add constraint physio_profiles_id_fkey FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.prescription_exercises add constraint prescription_exercises_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.prescription_exercises add constraint prescription_exercises_template_id_fkey FOREIGN KEY (template_id) REFERENCES exercise_templates(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.protocol_exercises add constraint protocol_exercises_exercise_template_id_fkey FOREIGN KEY (exercise_template_id) REFERENCES exercise_templates(id) ON DELETE CASCADE;
alter table public.protocol_exercises add constraint protocol_exercises_protocol_id_fkey FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON DELETE CASCADE;
alter table public.protocols add constraint protocols_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.protocols add constraint protocols_created_by_fkey FOREIGN KEY (created_by) REFERENCES physio_profiles(id) ON DELETE SET NULL;
alter table public.session_block_exercises add constraint session_block_exercises_exercise_template_id_fkey FOREIGN KEY (exercise_template_id) REFERENCES exercise_templates(id) ON DELETE CASCADE;
alter table public.session_block_exercises add constraint session_block_exercises_session_block_id_fkey FOREIGN KEY (session_block_id) REFERENCES session_blocks(id) ON DELETE CASCADE;
alter table public.session_blocks add constraint session_blocks_protocol_id_fkey FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON DELETE SET NULL;
alter table public.session_blocks add constraint session_blocks_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.session_debug_logs add constraint session_debug_logs_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
alter table public.session_debug_logs add constraint session_debug_logs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
alter table public.session_debug_logs add constraint session_debug_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.session_results add constraint session_results_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.session_results add constraint session_results_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
alter table public.session_results add constraint session_results_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table public.sessions add constraint sessions_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
alter table public.sessions add constraint sessions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
alter table public.sessions add constraint sessions_physio_id_fkey FOREIGN KEY (physio_id) REFERENCES physio_profiles(id) ON DELETE SET NULL;
alter table public.sessions add constraint sessions_source_protocol_id_fkey FOREIGN KEY (source_protocol_id) REFERENCES protocols(id) ON DELETE SET NULL;

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX exercise_templates_clinic_id_idx ON public.exercise_templates USING btree (clinic_id);
CREATE INDEX idx_session_debug_logs_captured_at ON public.session_debug_logs USING btree (captured_at DESC);
CREATE INDEX idx_session_debug_logs_session_id ON public.session_debug_logs USING btree (session_id);
CREATE INDEX patient_physios_clinic_id_idx ON public.patient_physios USING btree (clinic_id);
CREATE INDEX patient_physios_patient_id_idx ON public.patient_physios USING btree (patient_id);
CREATE INDEX patient_physios_physio_id_idx ON public.patient_physios USING btree (physio_id);
CREATE INDEX patients_clinic_id_idx ON public.patients USING btree (clinic_id);
CREATE INDEX protocol_exercises_protocol_id_idx ON public.protocol_exercises USING btree (protocol_id);
CREATE INDEX protocols_clinic_id_idx ON public.protocols USING btree (clinic_id);
CREATE INDEX protocols_tags_idx ON public.protocols USING gin (tags);
CREATE INDEX session_block_exercises_block_id_idx ON public.session_block_exercises USING btree (session_block_id);
CREATE INDEX session_blocks_session_id_idx ON public.session_blocks USING btree (session_id);
CREATE INDEX session_results_clinic_id_idx ON public.session_results USING btree (clinic_id);
CREATE INDEX session_results_patient_id_idx ON public.session_results USING btree (patient_id);
CREATE INDEX sessions_clinic_id_idx ON public.sessions USING btree (clinic_id);
CREATE INDEX sessions_patient_id_idx ON public.sessions USING btree (patient_id);
CREATE INDEX sessions_status_idx ON public.sessions USING btree (status);

-- ── Functions ───────────────────────────────────────────────
-- (As they are live. Security fixes to these come in a later migration.)

CREATE OR REPLACE FUNCTION public.my_clinic_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT clinic_id FROM public.physio_profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Creates profiles / physio_profiles rows when someone signs up.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_role text;
  v_full_name text;
  v_clinic_id uuid;
BEGIN
  v_role      := COALESCE(NEW.raw_user_meta_data->>'role', 'physio');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_clinic_id := COALESCE(
    (NEW.raw_user_meta_data->>'clinic_id')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );

  INSERT INTO public.profiles (id, role, full_name, created_at)
  VALUES (NEW.id, v_role, v_full_name, NOW())
  ON CONFLICT (id) DO NOTHING;

  IF v_role IN ('physio', 'clinic_admin') THEN
    INSERT INTO public.physio_profiles (id, clinic_id, clinic_name, created_at)
    SELECT NEW.id, c.id, c.name, NOW()
    FROM public.clinics c
    WHERE c.id = v_clinic_id
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_patient_clinic_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := public.my_clinic_id();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_protocol_clinic_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := public.my_clinic_id();
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_session_clinic_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := public.my_clinic_id();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_template_clinic_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL AND NEW.is_vanilla = false THEN
    NEW.clinic_id := public.my_clinic_id();
  END IF;
  IF NEW.created_by IS NULL AND NEW.is_vanilla = false THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_session_result_clinic_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := public.my_clinic_id();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_debug_log_clinic_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.clinic_id IS NULL AND NEW.session_id IS NOT NULL THEN
    SELECT clinic_id INTO NEW.clinic_id
    FROM public.sessions
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Supabase's own helper: switches RLS on for any new public table.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ── Triggers ────────────────────────────────────────────────

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER clinics_updated_at BEFORE UPDATE ON public.clinics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER exercise_templates_updated_at BEFORE UPDATE ON public.exercise_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER protocols_updated_at BEFORE UPDATE ON public.protocols FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER patient_set_clinic_id BEFORE INSERT ON public.patients FOR EACH ROW EXECUTE FUNCTION set_patient_clinic_id();
CREATE TRIGGER protocol_set_clinic_id BEFORE INSERT ON public.protocols FOR EACH ROW EXECUTE FUNCTION set_protocol_clinic_id();
CREATE TRIGGER session_set_clinic_id BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_session_clinic_id();
CREATE TRIGGER template_set_clinic_id BEFORE INSERT ON public.exercise_templates FOR EACH ROW EXECUTE FUNCTION set_template_clinic_id();
CREATE TRIGGER session_result_set_clinic_id BEFORE INSERT ON public.session_results FOR EACH ROW EXECUTE FUNCTION set_session_result_clinic_id();
CREATE TRIGGER trg_set_debug_log_clinic_id BEFORE INSERT ON public.session_debug_logs FOR EACH ROW EXECUTE FUNCTION set_debug_log_clinic_id();

-- ── Row level security (on for every table) ─────────────────

alter table public.clinics enable row level security;
alter table public.exercise_phases enable row level security;
alter table public.exercise_results enable row level security;
alter table public.exercise_templates enable row level security;
alter table public.patient_continuity_cache enable row level security;
alter table public.patient_physios enable row level security;
alter table public.patient_profiles enable row level security;
alter table public.patients enable row level security;
alter table public.phase_coaching_scripts enable row level security;
alter table public.physio_profiles enable row level security;
alter table public.prescription_exercises enable row level security;
alter table public.profiles enable row level security;
alter table public.protocol_exercises enable row level security;
alter table public.protocols enable row level security;
alter table public.session_block_exercises enable row level security;
alter table public.session_blocks enable row level security;
alter table public.session_debug_logs enable row level security;
alter table public.session_results enable row level security;
alter table public.sessions enable row level security;

-- ── Policies ────────────────────────────────────────────────
-- Physios see their own clinic's rows (my_clinic_id()). The patient
-- session page reads with the service role on the server, so it
-- bypasses these.

create policy own_profile on public.profiles as PERMISSIVE for ALL to public using ((id = auth.uid()));
create policy own_patient_profile on public.patient_profiles as PERMISSIVE for ALL to public using ((id = auth.uid()));
create policy physio_own_profile on public.physio_profiles as PERMISSIVE for ALL to public using ((id = auth.uid()));
create policy clinic_admin_physio_profiles on public.physio_profiles as PERMISSIVE for SELECT to public using (((clinic_id = my_clinic_id()) AND (my_role() = ANY (ARRAY['clinic_admin'::text, 'super_admin'::text]))));

create policy physio_read_own_clinic on public.clinics as PERMISSIVE for SELECT to public using ((id = my_clinic_id()));
create policy super_admin_all_clinics on public.clinics as PERMISSIVE for ALL to public using ((my_role() = 'super_admin'::text));

create policy physio_read_clinic_patients on public.patients as PERMISSIVE for SELECT to public using ((clinic_id = my_clinic_id()));
create policy physio_insert_patient on public.patients as PERMISSIVE for INSERT to public with check ((clinic_id = my_clinic_id()));
create policy physio_update_patient on public.patients as PERMISSIVE for UPDATE to public using ((clinic_id = my_clinic_id()));
create policy physio_delete_patient on public.patients as PERMISSIVE for DELETE to public using ((clinic_id = my_clinic_id()));

create policy physio_read_patient_physios on public.patient_physios as PERMISSIVE for SELECT to public using ((clinic_id = my_clinic_id()));
create policy physio_manage_patient_physios on public.patient_physios as PERMISSIVE for ALL to public using ((physio_id = auth.uid()));

create policy read_vanilla_or_clinic_templates on public.exercise_templates as PERMISSIVE for SELECT to public using (((is_vanilla = true) OR (clinic_id = my_clinic_id())));
create policy physio_manage_own_templates on public.exercise_templates as PERMISSIVE for ALL to public using (((clinic_id = my_clinic_id()) AND (created_by = auth.uid())));
create policy physio_update_vanilla_templates on public.exercise_templates as PERMISSIVE for UPDATE to public using (((is_vanilla = true) AND (auth.role() = 'authenticated'::text))) with check (((is_vanilla = true) AND (auth.role() = 'authenticated'::text)));

create policy exercise_phases_read_system on public.exercise_phases as PERMISSIVE for SELECT to public using ((is_system = true));
create policy exercise_phases_read_clinic on public.exercise_phases as PERMISSIVE for SELECT to public using ((EXISTS ( SELECT 1
   FROM physio_profiles pp
  WHERE ((pp.id = auth.uid()) AND (pp.clinic_id = my_clinic_id())))));
create policy exercise_phases_physio_insert on public.exercise_phases as PERMISSIVE for INSERT to public with check ((created_by = auth.uid()));
create policy exercise_phases_physio_update on public.exercise_phases as PERMISSIVE for UPDATE to public using ((created_by = auth.uid()));

create policy coaching_scripts_read_system on public.phase_coaching_scripts as PERMISSIVE for SELECT to public using ((clinic_id IS NULL));
create policy coaching_scripts_read_clinic on public.phase_coaching_scripts as PERMISSIVE for SELECT to public using ((clinic_id = my_clinic_id()));
create policy coaching_scripts_physio_insert on public.phase_coaching_scripts as PERMISSIVE for INSERT to public with check (((clinic_id IS NULL) OR (clinic_id = my_clinic_id())));
create policy coaching_scripts_physio_update on public.phase_coaching_scripts as PERMISSIVE for UPDATE to public using (((clinic_id IS NULL) OR (clinic_id = my_clinic_id())));

create policy physio_read_protocols on public.protocols as PERMISSIVE for SELECT to public using ((clinic_id = my_clinic_id()));
create policy physio_manage_protocols on public.protocols as PERMISSIVE for ALL to public using (((clinic_id = my_clinic_id()) AND (created_by = auth.uid())));
create policy physio_read_protocol_exercises on public.protocol_exercises as PERMISSIVE for SELECT to public using ((protocol_id IN ( SELECT protocols.id
   FROM protocols
  WHERE (protocols.clinic_id = my_clinic_id()))));
create policy physio_manage_protocol_exercises on public.protocol_exercises as PERMISSIVE for ALL to public using ((protocol_id IN ( SELECT protocols.id
   FROM protocols
  WHERE ((protocols.clinic_id = my_clinic_id()) AND (protocols.created_by = auth.uid())))));

create policy physio_read_sessions on public.sessions as PERMISSIVE for SELECT to public using ((clinic_id = my_clinic_id()));
create policy physio_manage_sessions on public.sessions as PERMISSIVE for ALL to public using ((clinic_id = my_clinic_id()));
create policy physio_read_session_blocks on public.session_blocks as PERMISSIVE for SELECT to public using ((session_id IN ( SELECT sessions.id
   FROM sessions
  WHERE (sessions.clinic_id = my_clinic_id()))));
create policy physio_manage_session_blocks on public.session_blocks as PERMISSIVE for ALL to public using ((session_id IN ( SELECT sessions.id
   FROM sessions
  WHERE (sessions.clinic_id = my_clinic_id()))));
create policy physio_read_session_block_exercises on public.session_block_exercises as PERMISSIVE for SELECT to public using ((session_block_id IN ( SELECT sb.id
   FROM (session_blocks sb
     JOIN sessions s ON ((s.id = sb.session_id)))
  WHERE (s.clinic_id = my_clinic_id()))));
create policy physio_manage_session_block_exercises on public.session_block_exercises as PERMISSIVE for ALL to public using ((session_block_id IN ( SELECT sb.id
   FROM (session_blocks sb
     JOIN sessions s ON ((s.id = sb.session_id)))
  WHERE (s.clinic_id = my_clinic_id()))));
create policy physio_read_prescription_exercises on public.prescription_exercises as PERMISSIVE for SELECT to public using ((prescription_id IN ( SELECT sessions.id
   FROM sessions
  WHERE (sessions.clinic_id = my_clinic_id()))));

create policy physio_read_session_results on public.session_results as PERMISSIVE for SELECT to public using ((clinic_id = my_clinic_id()));
create policy physio_insert_session_results on public.session_results as PERMISSIVE for INSERT to public with check ((clinic_id = my_clinic_id()));
create policy physio_update_session_results on public.session_results as PERMISSIVE for UPDATE to public using ((clinic_id = my_clinic_id()));
create policy physio_read_exercise_results on public.exercise_results as PERMISSIVE for SELECT to public using ((session_result_id IN ( SELECT session_results.id
   FROM session_results
  WHERE (session_results.clinic_id = my_clinic_id()))));
create policy physio_insert_exercise_results on public.exercise_results as PERMISSIVE for INSERT to public with check ((session_result_id IN ( SELECT session_results.id
   FROM session_results
  WHERE (session_results.clinic_id = my_clinic_id()))));

create policy continuity_patient_reads on public.patient_continuity_cache as PERMISSIVE for SELECT to public using ((patient_id = auth.uid()));
create policy continuity_physio_manages on public.patient_continuity_cache as PERMISSIVE for ALL to public using ((patient_id IN ( SELECT patients.id
   FROM patients
  WHERE (patients.clinic_id = my_clinic_id()))));

create policy "Authenticated users can insert debug logs" on public.session_debug_logs as PERMISSIVE for INSERT to authenticated with check (((session_id IN ( SELECT sessions.id
   FROM sessions
  WHERE (sessions.patient_id = auth.uid()))) OR (session_id IN ( SELECT s.id
   FROM (sessions s
     JOIN physio_profiles pp ON ((pp.clinic_id = s.clinic_id)))
  WHERE (pp.id = auth.uid())))));
create policy "Users can read relevant debug logs" on public.session_debug_logs as PERMISSIVE for SELECT to authenticated using (((session_id IN ( SELECT sessions.id
   FROM sessions
  WHERE (sessions.patient_id = auth.uid()))) OR (session_id IN ( SELECT s.id
   FROM (sessions s
     JOIN physio_profiles pp ON ((pp.clinic_id = s.clinic_id)))
  WHERE (pp.id = auth.uid())))));
