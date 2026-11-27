-- ============================================================
-- Pausing and resuming a session
-- ============================================================
-- A session that ends with exercises left is 'paused' and can be
-- resumed the same day (the owner's decision, 2026-11-27). Early
-- endings used to set 'partially_completed', which the check
-- rejected, so they stayed 'pending'.
--
-- progress: { "done": [exercise indexes finished], "total": n,
--             "updated_at": iso time }
-- paused_at / pause_reason ('ended', 'walked_away'): when and why.
-- Written by the server route app/api/session/progress (service role,
-- the session id is the key, like the session page itself).
-- ============================================================

alter table public.sessions drop constraint if exists sessions_status_check;
alter table public.sessions add constraint sessions_status_check
  check (status = any (array['pending', 'in_progress', 'paused', 'completed', 'missed', 'cancelled']));

alter table public.sessions add column if not exists progress jsonb;
alter table public.sessions add column if not exists paused_at timestamptz;
alter table public.sessions add column if not exists pause_reason text;
