-- ============================================================
-- AI Physio Platform — Supabase Migration
-- PIPEDA compliant — Canada Central region
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase Auth users)
-- ============================================================
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null check (role in ('physio', 'patient')),
  full_name text not null,
  created_at timestamptz default now()
);

create table physio_profiles (
  id uuid references profiles(id) on delete cascade primary key,
  clinic_name text,
  license_number text,
  created_at timestamptz default now()
);

create table patient_profiles (
  id uuid references profiles(id) on delete cascade primary key,
  physio_id uuid references physio_profiles(id) on delete set null,
  date_of_birth date,
  patient_type text not null default 'general_fitness'
    check (patient_type in ('general_fitness', 'post_surgery', 'elderly', 'pediatric')),
  condition_notes text,           -- store encrypted in production
  goals text,
  consent_given_at timestamptz,   -- PIPEDA: explicit consent timestamp
  consent_version text,           -- which version of consent form
  data_retention_until date,      -- PIPEDA: right to erasure date
  created_at timestamptz default now()
);

-- ============================================================
-- EXERCISE LIBRARY
-- ============================================================
create table exercise_templates (
  id uuid default uuid_generate_v4() primary key,
  created_by uuid references physio_profiles(id) on delete set null,
  is_vanilla boolean not null default false,  -- system templates
  name text not null,
  display_name text not null,
  exercise_type text not null
    check (exercise_type in ('arm_raise', 'bilateral_arm_raise', 'sit_to_stand', 'custom')),
  description text,
  clinical_objective text,

  -- Movement parameters (physio-adjustable)
  default_reps int not null default 6,
  default_hold_ms int not null default 2000,
  default_rest_ms int not null default 1000,
  target_metric_degrees float not null default 70.0,
  bilateral boolean not null default false,

  -- Coaching text (jsonb for flexibility)
  coaching_strings jsonb not null default '{
    "intro": "Perform the exercise as instructed.",
    "hold": ["Hold it there.", "Hold there.", "Stay there.", "Good, hold.", "Keep it up."],
    "success": ["Good.", "That'\''s it.", "Well done."],
    "correction_height": "Lift a little higher.",
    "correction_hold": "Hold for the full duration.",
    "correction_balance": "Keep your posture steady.",
    "exercise_complete": "Good work on that set."
  }',

  -- What the biomechanics engine measures for this exercise
  measurement_spec jsonb not null default '{
    "primary_metric": "arm_elevation_angle",
    "threshold_degrees": 70,
    "bilateral_check": false,
    "confidence_minimum": 0.7
  }',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- SESSION PRESCRIPTIONS
-- ============================================================
create table session_prescriptions (
  id uuid default uuid_generate_v4() primary key,
  physio_id uuid references physio_profiles(id) on delete set null,
  patient_id uuid references patient_profiles(id) on delete cascade,
  title text not null,
  objective text,
  due_date date,
  estimated_duration_mins int default 10,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'missed', 'cancelled')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table prescription_exercises (
  id uuid default uuid_generate_v4() primary key,
  prescription_id uuid references session_prescriptions(id) on delete cascade,
  template_id uuid references exercise_templates(id) on delete restrict,
  sequence_order int not null default 0,

  -- Physio overrides (null = use template defaults)
  reps_override int,
  hold_ms_override int,
  rest_ms_override int,
  coaching_notes text,        -- physio's specific notes for this patient/exercise

  created_at timestamptz default now()
);

-- ============================================================
-- SESSION RESULTS
-- ============================================================
create table session_results (
  id uuid default uuid_generate_v4() primary key,
  prescription_id uuid references session_prescriptions(id) on delete set null,
  patient_id uuid references patient_profiles(id) on delete cascade,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms int,
  mobility_score float check (mobility_score >= 0 and mobility_score <= 100),
  claude_summary text,         -- AI-generated clinical note
  physio_reviewed boolean default false,
  physio_notes text,
  created_at timestamptz default now()
);

create table exercise_results (
  id uuid default uuid_generate_v4() primary key,
  session_result_id uuid references session_results(id) on delete cascade,
  template_id uuid references exercise_templates(id) on delete set null,
  prescription_exercise_id uuid references prescription_exercises(id) on delete set null,
  sequence_order int not null default 0,

  -- Performance metrics
  reps_prescribed int not null,
  reps_attempted int not null default 0,
  reps_successful int not null default 0,
  reps_failed int not null default 0,
  hold_compliance_rate float,   -- 0.0 - 1.0
  avg_hold_ms float,
  avg_metric_degrees float,
  target_metric_degrees float,

  -- Failure breakdown
  failed_hold_count int default 0,
  failed_height_count int default 0,
  failed_balance_count int default 0,
  failed_isolation_count int default 0,

  -- Raw data (for replay and audit - PIPEDA: patient can request this)
  movement_timeline jsonb,

  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table physio_profiles enable row level security;
alter table patient_profiles enable row level security;
alter table exercise_templates enable row level security;
alter table session_prescriptions enable row level security;
alter table prescription_exercises enable row level security;
alter table session_results enable row level security;
alter table exercise_results enable row level security;

-- Helper function: get current user's role
create or replace function get_my_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer;

-- Helper function: get current user's physio_id (if patient)
create or replace function get_my_physio_id()
returns uuid as $$
  select physio_id from patient_profiles where id = auth.uid();
$$ language sql security definer;

-- PROFILES: users can read their own profile
create policy "profiles_read_own" on profiles
  for select using (id = auth.uid());

create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());

create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- PHYSIO PROFILES
create policy "physio_profiles_read_own" on physio_profiles
  for select using (id = auth.uid());

create policy "physio_profiles_insert_own" on physio_profiles
  for insert with check (id = auth.uid());

create policy "physio_profiles_update_own" on physio_profiles
  for update using (id = auth.uid());

-- PATIENT PROFILES: patient sees own, physio sees their patients
create policy "patient_profiles_patient_own" on patient_profiles
  for select using (id = auth.uid());

create policy "patient_profiles_physio_sees_theirs" on patient_profiles
  for select using (physio_id = auth.uid());

create policy "patient_profiles_physio_manages" on patient_profiles
  for all using (physio_id = auth.uid());

-- EXERCISE TEMPLATES: vanilla visible to all, owned visible to creator
create policy "templates_vanilla_read" on exercise_templates
  for select using (is_vanilla = true);

create policy "templates_owned_read" on exercise_templates
  for select using (created_by = auth.uid());

create policy "templates_physio_insert" on exercise_templates
  for insert with check (
    get_my_role() = 'physio' and created_by = auth.uid()
  );

create policy "templates_physio_update_own" on exercise_templates
  for update using (created_by = auth.uid());

create policy "templates_physio_delete_own" on exercise_templates
  for delete using (created_by = auth.uid() and is_vanilla = false);

-- SESSION PRESCRIPTIONS: physio manages, patient reads own
create policy "prescriptions_physio_manages" on session_prescriptions
  for all using (physio_id = auth.uid());

create policy "prescriptions_patient_reads" on session_prescriptions
  for select using (patient_id = auth.uid());

-- PRESCRIPTION EXERCISES
create policy "presc_exercises_physio" on prescription_exercises
  for all using (
    exists (
      select 1 from session_prescriptions sp
      where sp.id = prescription_id and sp.physio_id = auth.uid()
    )
  );

create policy "presc_exercises_patient_reads" on prescription_exercises
  for select using (
    exists (
      select 1 from session_prescriptions sp
      where sp.id = prescription_id and sp.patient_id = auth.uid()
    )
  );

-- SESSION RESULTS: patient writes own, physio reads their patients'
create policy "session_results_patient_writes" on session_results
  for all using (patient_id = auth.uid());

create policy "session_results_physio_reads" on session_results
  for select using (
    exists (
      select 1 from patient_profiles pp
      where pp.id = patient_id and pp.physio_id = auth.uid()
    )
  );

create policy "session_results_physio_updates" on session_results
  for update using (
    exists (
      select 1 from patient_profiles pp
      where pp.id = patient_id and pp.physio_id = auth.uid()
    )
  );

-- EXERCISE RESULTS
create policy "exercise_results_patient_writes" on exercise_results
  for all using (
    exists (
      select 1 from session_results sr
      where sr.id = session_result_id and sr.patient_id = auth.uid()
    )
  );

create policy "exercise_results_physio_reads" on exercise_results
  for select using (
    exists (
      select 1 from session_results sr
      join patient_profiles pp on pp.id = sr.patient_id
      where sr.id = session_result_id and pp.physio_id = auth.uid()
    )
  );

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP (via trigger)
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'patient'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- UPDATED_AT trigger
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger exercise_templates_updated_at
  before update on exercise_templates
  for each row execute procedure update_updated_at();

create trigger session_prescriptions_updated_at
  before update on session_prescriptions
  for each row execute procedure update_updated_at();
