-- ============================================================
-- Security hardening (NOT yet applied to the live project)
-- ============================================================
-- Fixes found in the 2026-11-25 review:
--
-- 1. Sign-up trusted the browser. handle_new_user() took the role
--    and clinic from the sign-up form's metadata, so anyone could
--    register as super_admin (full access to every clinic) or join
--    any clinic and read its patients. Now every new account is a
--    'physio' with NO clinic until an admin assigns one:
--      update public.physio_profiles
--         set clinic_id = '<clinic uuid>', clinic_name = '<name>'
--       where id = '<user uuid>';
--    Existing accounts are not changed.
--
-- 2. Any signed-in user could edit the system exercise templates.
--    Now only physios who belong to a clinic can.
--
-- 3. Functions had no fixed search_path (Supabase advisor 0011),
--    and the trigger-only functions were callable over the API
--    (advisors 0028/0029). Triggers still run as before.
-- ============================================================

-- ── 1. Sign-up: no self-chosen role or clinic ───────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, created_at)
  VALUES (NEW.id, 'physio', COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), NEW.email), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- Pending physio: no clinic, so my_clinic_id() is null and every
  -- clinic-scoped policy shows them nothing until an admin assigns one.
  INSERT INTO public.physio_profiles (id, clinic_id, clinic_name, created_at)
  VALUES (NEW.id, NULL, NULL, NOW())
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── 2. System templates: only clinic members may edit ───────

drop policy if exists physio_update_vanilla_templates on public.exercise_templates;
create policy physio_update_vanilla_templates on public.exercise_templates
  as permissive for update to authenticated
  using (is_vanilla = true and public.my_clinic_id() is not null)
  with check (is_vanilla = true and public.my_clinic_id() is not null);

-- ── 3. Fixed search_path on every function ──────────────────

alter function public.my_clinic_id() set search_path = public, pg_temp;
alter function public.my_role() set search_path = public, pg_temp;
alter function public.update_updated_at() set search_path = public, pg_temp;
alter function public.set_patient_clinic_id() set search_path = public, pg_temp;
alter function public.set_protocol_clinic_id() set search_path = public, pg_temp;
alter function public.set_session_clinic_id() set search_path = public, pg_temp;
alter function public.set_template_clinic_id() set search_path = public, pg_temp;
alter function public.set_session_result_clinic_id() set search_path = public, pg_temp;
alter function public.set_debug_log_clinic_id() set search_path = public, pg_temp;

-- Trigger functions are not an API: nobody needs to call them directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.update_updated_at() from public, anon, authenticated;
revoke execute on function public.set_patient_clinic_id() from public, anon, authenticated;
revoke execute on function public.set_protocol_clinic_id() from public, anon, authenticated;
revoke execute on function public.set_session_clinic_id() from public, anon, authenticated;
revoke execute on function public.set_template_clinic_id() from public, anon, authenticated;
revoke execute on function public.set_session_result_clinic_id() from public, anon, authenticated;
revoke execute on function public.set_debug_log_clinic_id() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- my_clinic_id() and my_role() stay callable: the policies use them,
-- and they only ever return the caller's own clinic and role.
