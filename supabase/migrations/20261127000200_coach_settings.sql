-- ============================================================
-- Coach settings, one row per clinic
-- ============================================================
-- The Coach Lab in /admin (the owner's request) saves the coach's
-- adjustable behaviour here: only the values that differ from the
-- defaults in lib/coach/coachSettings.ts. The session page reads the
-- row for the session's clinic with the service role, and
-- resolveCoachSettings keeps every value in range.
-- ============================================================

create table if not exists public.coach_settings (
  clinic_id  uuid primary key default public.my_clinic_id() references public.clinics(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.coach_settings enable row level security;

create policy physio_read_coach_settings on public.coach_settings
  for select using (clinic_id = public.my_clinic_id());
create policy physio_insert_coach_settings on public.coach_settings
  for insert with check (clinic_id = public.my_clinic_id());
create policy physio_update_coach_settings on public.coach_settings
  for update using (clinic_id = public.my_clinic_id()) with check (clinic_id = public.my_clinic_id());
