-- ============================================================
-- Per-patient tolerances on each assigned exercise
-- ============================================================
-- The physio sets these when assigning a protocol (the owner: clinical
-- tolerances are per-patient decisions, not clinic-wide): how far the arm
-- may drift out to the side and still hold, how long a slip in the hold
-- is ignored, how far the other arm may move. Only what the physio chose
-- is stored (lib/coach/patientTolerances.ts); missing values fall back to
-- the clinic's Coach Lab defaults.
-- ============================================================

alter table public.session_block_exercises add column if not exists tolerances jsonb;
