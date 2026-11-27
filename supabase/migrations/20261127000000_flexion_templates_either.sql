-- ============================================================
-- Shoulder flexion: front or side camera, seated or standing
-- ============================================================
-- Forward arm raises are now measured facing the camera too
-- (lib/biomechanics/flexionView.ts, world3d.ts). The owner set the
-- Right template to camera 'either', posture 'either'; the Left and
-- Bilateral ones still said side / standing, so a protocol of right
-- then left raises asked the patient to turn sideways between them
-- (run A-1A1194D5, 2026-11-27). The owner's decision: all three
-- 'either'. Data only; no schema change.
-- ============================================================

update public.exercise_templates
   set camera_position = 'either',
       patient_position = 'either'
 where is_vanilla = true
   and slug in ('shoulder_flexion_right', 'shoulder_flexion_left', 'shoulder_flexion_bilateral');
