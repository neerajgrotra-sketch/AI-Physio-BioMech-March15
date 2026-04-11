# AI Physio BioMech — Schema Recap
## State after Modules 5–8 | Ready for Module 9

---

## The Complete Table Map

### IDENTITY & AUTH (module 9 will wire Supabase Auth to these)

```
profiles
  id uuid → auth.users (Supabase Auth — NOT YET WIRED)
  role: physio | patient | clinic_admin | super_admin
  full_name text
  created_at

physio_profiles
  id uuid → profiles(id)
  clinic_id uuid → clinics(id)        ← added in migration 005
  clinic_name text (denormalised)
  license_number text
  created_at
  ⚠ RLS: ENABLED (not wired yet — will need policies in module 9)

patient_profiles
  id uuid → profiles(id)
  ← DEPRECATED — was part of original auth design
  ← patients table (below) is what's actually used
  ← will be retired when auth is added in module 9
```

---

### CLINIC (top-level entity — added migration 005)

```
clinics
  id uuid PK
  name text
  slug text UNIQUE                    ← url-safe e.g. "westside-physio"
  address, phone, email text
  timezone text DEFAULT 'America/Toronto'
  country_code text DEFAULT 'CA'      ← PIPEDA compliance
  is_active boolean
  created_at, updated_at

  ⚠ RLS: DISABLED
  ✓ Default clinic row inserted: id = 00000000-0000-0000-0000-000000000001
  ✓ All existing data assigned to default clinic
```

---

### PATIENTS (no auth dependency — MVP safe)

```
patients                              ← was: patients_mvp (renamed migration 005)
  id uuid PK
  clinic_id uuid → clinics(id)        ← added migration 005
  first_name, last_name, full_name text
  patient_type: general_fitness | post_surgery | senior | chronic_pain
  date_of_birth date
  height_cm float, weight_kg float
  photo_url text                      ← Supabase Storage
  condition_notes text                ← encrypt in production (PIPEDA)
  goals text
  consent_given_at timestamptz        ← PIPEDA
  data_retention_until date           ← PIPEDA right to erasure
  created_at

  ⚠ RLS: DISABLED (re-enable with clinic scoping in module 9)
  ✓ Indexes: clinic_id

patient_physios                       ← new in migration 006
  id uuid PK
  patient_id → patients(id) CASCADE
  physio_id → physio_profiles(id) CASCADE
  clinic_id → clinics(id) CASCADE
  is_primary boolean                  ← true = lead/suggested physio
  assigned_at timestamptz
  notes text
  UNIQUE (patient_id, physio_id)      ← no duplicate assignments

  ⚠ RLS: DISABLED
  ✓ Indexes: patient_id, physio_id, clinic_id
```

---

### EXERCISE LIBRARY

```
exercise_templates
  id uuid PK
  clinic_id uuid → clinics(id)        ← added migration 005
                                        NULL = vanilla/system (visible to all)
  created_by uuid → physio_profiles(id)
  is_vanilla boolean                  ← true = system template
  name text                           ← slug: "right-arm-raise" (biomechanics key)
  display_name text
  exercise_type: arm_raise | bilateral_arm_raise | sit_to_stand | custom
  description, clinical_objective text
  default_reps int, default_hold_ms int, default_rest_ms int
  target_metric_degrees float
  bilateral boolean
  coaching_strings jsonb              ← intro, hold[], lower, corrections, etc.
  measurement_spec jsonb              ← primary_metric, threshold, landmarks
  created_at, updated_at

  ⚠ RLS: DISABLED
  ✓ 4 vanilla system templates seeded (right-arm, left-arm, both-arm, sit-to-stand)
  ✓ Indexes: clinic_id
```

---

### PROTOCOLS (reusable clinical protocols — not patient-specific)

```
protocols                             ← was: session_templates (renamed 005)
  id uuid PK
  clinic_id uuid → clinics(id)        ← added migration 005
  created_by uuid → physio_profiles(id)
  title text                          ← "Shoulder Mobility A"
  objective text
  estimated_duration_mins int
  tags text[]                         ← ["shoulder", "mobility", "post_surgery"]
  created_at, updated_at

  ⚠ RLS: DISABLED
  ✓ Indexes: clinic_id, tags (GIN index for array search)

protocol_exercises                    ← was: session_template_exercises (renamed 005)
  id uuid PK
  protocol_id uuid → protocols(id) CASCADE    ← was: template_id (renamed 005)
  exercise_template_id uuid → exercise_templates(id) CASCADE
  sequence_order int
  default_reps int                    ← null = use exercise_template default
  default_hold_ms int                 ← null = use exercise_template default
  created_at

  ⚠ RLS: DISABLED
  ✓ Indexes: protocol_id
```

---

### SESSIONS (patient-specific assignments of protocols)

```
sessions                              ← was: session_prescriptions (renamed 005)
  id uuid PK
  clinic_id uuid → clinics(id)        ← added migration 005
  patient_id uuid → patients(id)
  physio_id uuid → physio_profiles(id) ← who created/assigned this session
  source_protocol_id uuid → protocols(id)  ← was: source_template_id (renamed 005)
  title text
  objective text
  scheduled_date date                 ← added migration 005 (optional)
  estimated_duration_mins int
  status: pending | in_progress | completed | missed | cancelled
  created_at, updated_at

  ⚠ RLS: DISABLED
  ✓ Indexes: clinic_id, patient_id, source_protocol_id, status

session_blocks                        ← NEW migration 006
  id uuid PK
  session_id uuid → sessions(id) CASCADE
  protocol_id uuid → protocols(id) SET NULL
  sequence_order int                  ← 0, 1, 2... (order of blocks)
  rest_before_ms int DEFAULT 0        ← rest screen before this block
  title_override text                 ← optional per-patient block rename
  notes text                          ← physio notes for this block
  created_at

  ⚠ RLS: DISABLED
  ✓ Indexes: session_id, protocol_id

session_block_exercises               ← NEW migration 006
  id uuid PK
  session_block_id uuid → session_blocks(id) CASCADE
  exercise_template_id uuid → exercise_templates(id) CASCADE
  sequence_order int
  reps_override int                   ← null = use protocol default
  hold_ms_override int                ← null = use protocol default
  coaching_notes text                 ← physio note for this patient+exercise
  created_at

  ⚠ RLS: DISABLED
  ✓ Indexes: session_block_id, exercise_template_id

prescription_exercises                ← KEPT for backward compat
  ← Pre-module-8 sessions wrote here directly
  ← New sessions use session_blocks → session_block_exercises
  ← Both paths are read in app/session/page.tsx (new path first, fallback)
  ← Can be retired once all pre-module-8 sessions have been re-assigned
```

---

### RESULTS

```
session_results
  id uuid PK
  prescription_id uuid → sessions(id) SET NULL   ← "prescription_id" = sessions.id
  patient_id uuid → patients(id) SET NULL         ← fixed in migration 003/005
  clinic_id uuid → clinics(id) SET NULL           ← added migration 005
  started_at timestamptz
  completed_at timestamptz
  duration_ms int
  mobility_score float                ← 0–100, computed at session end
  claude_summary text                 ← AI-generated, written at session end
  physio_reviewed boolean DEFAULT false
  physio_notes text
  created_at

  ⚠ RLS: DISABLED (disabled migration 003)
  ✓ Indexes: patient_id, prescription_id, clinic_id

exercise_results
  id uuid PK
  session_result_id uuid → session_results(id) CASCADE
  session_block_id uuid → session_blocks(id) SET NULL   ← added migration 006
  protocol_block_order int                               ← added migration 006
  template_id uuid → exercise_templates(id) SET NULL
  prescription_exercise_id uuid (backward compat)
  sequence_order int
  reps_prescribed, reps_attempted, reps_successful, reps_failed int
  hold_compliance_rate float          ← 0.0–1.0
  avg_hold_ms float                   ← NOT YET POPULATED
  avg_metric_degrees float            ← NOT YET POPULATED
  target_metric_degrees float
  failed_hold_count int
  failed_height_count int
  failed_balance_count int
  failed_isolation_count int
  movement_timeline jsonb             ← NOT YET POPULATED
  created_at

  ⚠ RLS: DISABLED
```

---

## RLS Status Summary

| Table | RLS | Notes |
|---|---|---|
| profiles | ENABLED | Not wired — module 9 |
| physio_profiles | ENABLED | Not wired — module 9 |
| patient_profiles | ENABLED | Deprecated — module 9 |
| clinics | DISABLED | Module 9 |
| patients | DISABLED | Module 9 |
| patient_physios | DISABLED | Module 9 |
| exercise_templates | DISABLED | Module 9 |
| protocols | DISABLED | Module 9 |
| protocol_exercises | DISABLED | Module 9 |
| sessions | DISABLED | Module 9 |
| session_blocks | DISABLED | Module 9 |
| session_block_exercises | DISABLED | Module 9 |
| prescription_exercises | DISABLED | Backward compat |
| session_results | DISABLED | Module 9 |
| exercise_results | DISABLED | Module 9 |

All RLS policies will be written in module 9 once Supabase Auth is wired.

---

## What Module 9 Needs to Do

### 1. Supabase Auth wiring
- Enable email/password auth in Supabase dashboard
- `profiles` table is already structured for auth.users extension
- Two registration flows needed:
  - **Physio registration** → creates `auth.users` + `profiles` (role: physio) + `physio_profiles` (clinic_id)
  - **Clinic registration** → creates `clinics` row, then physio row linked to it

### 2. RLS policies per role
For each table, three policy types:
- **Physio** → sees only their clinic's data (`clinic_id = physio's clinic_id`)
- **Patient** → sees only their own data (`patient_id = auth.uid()`)
- **Clinic admin** → sees all data for their clinic
- **Super admin** → sees everything (future)

### 3. Route protection
- `/admin` → requires physio or clinic_admin role
- `/session` → requires valid prescription that belongs to the patient
- `/patient` → requires patient role or valid patient UUID (current MVP)

### 4. Retire patient_profiles table
- Currently unused (patients live in `patients` table, no auth)
- In module 9, patients who self-register will get `auth.users` + `profiles` + entry in `patients` with their `auth.uid()` as a link

### 5. Vocabulary that should NOT change
- `patients` table stays — it's the right name
- `sessions` table stays
- `protocols` / `protocol_exercises` stay
- `session_blocks` / `session_block_exercises` stay
- Only `prescription_exercises` gets retired (backward compat done)

---

## Known Gaps to Address in Module 9 or Later

| Gap | Priority | Module |
|---|---|---|
| Auth — physio login | Critical | 9 |
| Auth — patient login | High | 9 |
| RLS policies | Critical | 9 |
| `avg_metric_degrees` never populated | Medium | 10 |
| `avg_hold_ms` never populated | Medium | 10 |
| `movement_timeline` never written to DB | Medium | 10 |
| `rep_results` table missing | Medium | 10 |
| Per-rep analytics collection | Medium | 10 |
| Treatment programmes (multi-session plans) | Low | 11 |
| Multi-block session assignment UI | Low | 9/10 |
| Patient self-registration | Medium | 9 |
| Clinic admin dashboard | Low | 10 |
| Email invite workflow | Low | 10 |
| `prescription_exercises` retirement | Low | 10 |
