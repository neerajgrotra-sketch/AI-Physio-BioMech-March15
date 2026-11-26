-- session_debug_logs: allow the new flush reasons.
-- SessionRunner now saves the debug log every 30 s while a session runs
-- ('periodic') and when the tab is hidden or closed ('page_hidden'), so a
-- test run reaches the database even if it is never ended with End. The old
-- check allowed only session_end / pause / error / manual, so those saves
-- were rejected. Widening only: existing rows are unaffected.
alter table public.session_debug_logs drop constraint if exists session_debug_logs_flush_reason_check;
alter table public.session_debug_logs add constraint session_debug_logs_flush_reason_check
  check (flush_reason = any (array['session_end', 'pause', 'error', 'manual', 'periodic', 'page_hidden']::text[]));
