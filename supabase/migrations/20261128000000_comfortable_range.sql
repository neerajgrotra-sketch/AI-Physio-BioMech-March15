-- ============================================================
-- The comfortable range from the range check (v0.12.0)
-- ============================================================
-- Before each arm's first forward raise the patient lifts it as high as is
-- comfortable, once (lib/session/reachCheck.ts). The highest measured angle,
-- on the same scale as the target, is kept on that exercise's result so the
-- physio can see today's range next to the target. Null when no check ran.
-- ============================================================

alter table public.exercise_results add column if not exists comfortable_range_deg numeric;
