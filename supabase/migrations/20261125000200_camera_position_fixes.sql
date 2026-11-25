-- ============================================================
-- Camera position data fix
-- ============================================================
-- A forward arm raise (shoulder flexion) and a seated knee
-- extension move toward a front camera, where a 2D camera cannot
-- see them, so both are measured side-on. The templates said
-- 'front'. The app's positioning coach decides the camera side in
-- code (lib/positioning/positionCoach.ts, positionSetupFor); this
-- makes the admin page show the same thing.
-- ============================================================

update public.exercise_templates
   set camera_position = 'side'
 where is_vanilla = true
   and slug in ('shoulder_flexion_right', 'shoulder_flexion_left', 'shoulder_flexion_bilateral', 'knee_extension_bilateral')
   and camera_position <> 'side';
