-- ============================================================
-- Seed data: the default clinic and the 10 system ("vanilla")
-- exercise templates, exactly as they are in the live project
-- (exported 2026-11-25). Safe to re-run: existing rows are kept.
--
-- camera_position for shoulder_flexion_* and knee_extension_bilateral
-- is 'side', as corrected by 20261125000200_camera_position_fixes.sql.
-- Known data problems (left as they are live; handled in code, see
-- CLAUDE.md "Exercise data notes"):
--  - knee_extension_* measure from 90 (bent) down to 0 (straight);
--    measurement_spec.primary_metric for the left knee says
--    leftElbowAngleDeg and the right knee's spec is a copy of the
--    arm one. The app does not read measurement_spec at runtime.
-- ============================================================

insert into public.clinics (id, name, slug, timezone, country_code)
values ('00000000-0000-0000-0000-000000000001', 'Default Clinic', 'default-clinic', 'America/Toronto', 'CA')
on conflict (id) do nothing;

insert into public.exercise_templates (id, is_vanilla, slug, clinical_name, display_name, exercise_type, description, clinical_objective, default_reps, default_hold_ms, default_rest_ms, target_metric_degrees, bilateral, coaching_strings, measurement_spec, plane_of_motion, laterality, coaching_persona, coaching_focus, rom_start_degrees, rom_norm_degrees, rom_max_degrees, rom_acceptable_min, patient_position, camera_position, rom_unit, required_coverage) values
('d54e2f33-cad3-4069-9bce-a64d57962bec', true, 'knee_extension_bilateral', 'Knee Extension — Bilateral', 'Both Legs Straight', 'knee_extension',
 'From a seated position, straighten both knees simultaneously until legs are fully extended. Hold, then lower both legs slowly together.', NULL,
 10, 3000, 1000, 0, true,
 '{"hold": ["Hold both legs up.", "Keep both straight.", "Good, hold.", "Stay there.", "Keep holding both."], "lift": "Straighten both legs at the same time.", "intro": "Sit upright with both feet resting on the floor. When ready, straighten both legs together.", "lower": "Lower both legs slowly together.", "success_first": "Good first rep.", "correction_hold": "Hold a little longer at the top.", "success_rotating": ["Good.", "Well done.", "Both legs together.", "Keep going.", "Strong."], "correction_height": "Try to straighten both legs a little more.", "exercise_complete": "Good work on that set.", "correction_balance": "Sit upright and keep your hips level.", "correction_isolation": "Lift both legs together and keep them even."}'::jsonb,
 '{"key_landmarks": ["left_hip", "left_knee", "right_hip", "right_knee"], "primary_metric": "kneeToHipExtensionScore", "bilateral_check": true, "threshold_degrees": 30, "confidence_minimum": 0.6}'::jsonb,
 'sagittal', 'bilateral', 'encouraging', 'balanced', 90, 0, 0, 30, 'seated', 'side', 'degrees', 'torso_and_hips'),

('eec303cd-62d3-4320-bdf7-1c291315526d', true, 'knee_extension_left', 'Knee Extension — Unilateral Left', 'Left Leg Straighten', 'knee_extension',
 'From a seated position, straighten your left knee until your leg is fully extended or as instructed. Hold, then lower slowly back to the starting position.', NULL,
 10, 3000, 1000, 0, false,
 '{"hold": ["Hold it there.", "Keep it straight.", "Good, hold.", "Stay there.", "Keep holding."], "lift": "Straighten your left leg fully.", "intro": "Sit upright with your left foot resting on the floor. When ready, straighten your left leg.", "lower": "Lower your leg slowly.", "success_first": "Good first rep.", "correction_hold": "Hold a little longer at the top.", "success_rotating": ["Good.", "Well done.", "That is it.", "Keep going.", "Strong rep."], "correction_height": "Try to straighten your leg a little more.", "exercise_complete": "Good work on that set.", "correction_balance": "Sit upright and keep your hips level.", "correction_isolation": "Use only your left leg for this exercise."}'::jsonb,
 '{"key_landmarks": ["left_hip", "left_knee", "left_ankle"], "primary_metric": "leftElbowAngleDeg", "bilateral_check": false, "threshold_degrees": 30, "confidence_minimum": 0.6}'::jsonb,
 'sagittal', 'unilateral_left', 'encouraging', 'balanced', 90, 0, 0, 30, 'seated', 'side', 'degrees', 'torso_and_hips'),

('ce689748-4b95-424a-8b0e-f4acf0933aae', true, 'knee_extension_right', 'Knee Extension — Unilateral Right', 'Right Leg Straighten', 'knee_extension',
 'From a seated position, straighten your right knee until your leg is fully extended. Hold, then lower slowly back to the starting position.', NULL,
 10, 3000, 1000, 70, false,
 '{"hold": ["Hold it straight.", "Keep your leg extended.", "Good, hold.", "Stay there.", "Keep holding."], "lift": "Straighten your leg out.", "intro": "Straighten your right leg fully, hold, then lower slowly.", "lower": "Lower slowly back down.", "success_first": "Good first rep.", "correction_hold": "Hold for the full duration.", "success_rotating": ["Good.", "Well done.", "That is it.", "Keep going.", "Strong rep."], "correction_height": "Try to fully straighten your knee.", "correction_balance": "Keep your hips level — avoid tilting."}'::jsonb,
 '{"key_landmarks": ["right_shoulder", "right_elbow", "right_wrist"], "primary_metric": "arm_elevation_angle", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb,
 'sagittal', 'unilateral_right', 'encouraging', 'balanced', 90, 0, 0, 30, 'seated', 'side', 'degrees', 'torso_and_hips'),

('6a94e99a-cfe2-48a8-8dbc-41bdb93d99c0', true, 'shoulder_abduction_bilateral', 'Shoulder Abduction — Bilateral', 'Both Arms Out', 'shoulder_abduction',
 'Raise both arms out to the sides simultaneously, keeping elbows straight and palms facing down. Lower slowly with control.', NULL,
 10, 3000, 1000, 70, true,
 '{"hold": ["Hold at the top.", "Keep both arms steady.", "Good, hold.", "Stay there.", "Keep holding both."], "lift": "Raise both arms out and up symmetrically.", "intro": "Lift both arms out to the sides, all the way overhead.", "lower": "Lower both arms slowly back to your sides.", "success_first": "Good first rep.", "correction_hold": "Hold for the full duration at the top.", "success_rotating": ["Good.", "Well done.", "Both arms strong.", "Keep going.", "Nice."], "correction_height": "Try to get both arms higher.", "correction_balance": "Keep your torso upright — avoid leaning to either side."}'::jsonb,
 '{"key_landmarks": ["right_shoulder", "right_elbow", "right_wrist"], "primary_metric": "arm_elevation_angle", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb,
 'frontal', 'bilateral', 'encouraging', 'balanced', 0, 150, 180, 100, 'standing', 'front', 'degrees', 'upper_body'),

('4d6f5e39-6f90-4b5b-aadd-48d862cc63d2', true, 'shoulder_abduction_left', 'Shoulder Abduction — Unilateral Left', 'Left Arm Out', 'shoulder_abduction',
 'Raise your left arm out to the side to shoulder height or as instructed, keeping the elbow straight. Lower slowly back to your side.', NULL,
 6, 3000, 1000, 70, false,
 '{"hold": ["Hold at the top.", "Keep it steady overhead.", "Good, hold.", "Stay there.", "Keep holding."], "lift": "Raise your arm out and up.", "intro": "Lift your left arm out to the side, all the way overhead.", "lower": "Lower slowly back to your side.", "success_first": "Good first rep.", "correction_hold": "Hold for the full duration at the top.", "success_rotating": ["Good.", "Well done.", "That is it.", "Keep going.", "Nice."], "correction_height": "Try to get your arm higher.", "correction_balance": "Keep your torso upright — avoid leaning."}'::jsonb,
 '{"key_landmarks": ["right_shoulder", "right_elbow", "right_wrist"], "primary_metric": "arm_elevation_angle", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb,
 'frontal', 'unilateral_left', 'encouraging', 'balanced', 0, 150, 180, 110, 'standing', 'front', 'degrees', 'upper_body'),

('88ed4cf2-39f9-4c7c-9401-f20a12d42cac', true, 'shoulder_abduction_right', 'Shoulder Abduction — Unilateral Right', 'Right Arm Out', 'shoulder_abduction',
 'Raise your right arm out to the side to the prescribed height, keeping the elbow straight and palm facing down. Lower back to your side.', NULL,
 10, 3000, 1000, 70, false,
 '{"hold": ["Hold at the top.", "Keep it steady overhead.", "Good, hold.", "Stay there.", "Keep holding."], "lift": "Raise your arm out and up.", "intro": "Lift your right arm out to the side, all the way overhead.", "lower": "Lower slowly back to your side.", "success_first": "Good first rep.", "correction_hold": "Hold for the full duration at the top.", "success_rotating": ["Good.", "Well done.", "That is it.", "Keep going.", "Nice."], "correction_height": "Try to get your arm higher.", "correction_balance": "Keep your torso upright — avoid leaning."}'::jsonb,
 '{"key_landmarks": ["right_shoulder", "right_elbow", "right_wrist"], "primary_metric": "arm_elevation_angle", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb,
 'frontal', 'unilateral_right', 'encouraging', 'balanced', 0, 150, 180, 100, 'standing', 'front', 'degrees', 'upper_body'),

('386e67b0-1371-4ee2-b751-77893b47bd59', true, 'shoulder_flexion_bilateral', 'Shoulder Flexion — Bilateral', 'Both Arms Raise', 'shoulder_flexion',
 'Raise both arms forward and upward simultaneously, keeping elbows straight. Lower slowly and with control back to your sides.', 'Improve bilateral shoulder flexion and symmetry.',
 6, 3000, 1000, 70, true,
 '{"hold": ["Hold it there.", "Hold there.", "Stay there.", "Good, hold.", "Keep it up."], "lift": "Raise both arms forward to shoulder height.", "intro": "Lift both arms to shoulder height, hold for 3 seconds, then lower. Six repetitions total. This helps build shoulder strength.", "lower": "Lower slowly.", "success_first": "Good work.", "correction_hold": "Hold for the full duration.", "success_rotating": ["Good.", "That is it.", "Well done.", "Keep it up.", "Nice work."], "correction_height": "Lift a little higher.", "exercise_complete": "Good work on that set.", "correction_balance": "Keep your posture steady.", "correction_isolation": "Keep the movement symmetrical."}'::jsonb,
 '{"key_landmarks": ["left_shoulder", "left_elbow", "right_shoulder", "right_elbow"], "primary_metric": "bilateralArmElevationDeg", "bilateral_check": true, "threshold_degrees": 70, "confidence_minimum": 0.7, "symmetry_threshold_degrees": 15}'::jsonb,
 'sagittal', 'bilateral', 'encouraging', 'balanced', 0, 160, 180, 110, 'standing', 'side', 'degrees', 'upper_body'),

('49db00a5-6604-4868-b00a-eb023f20c933', true, 'shoulder_flexion_left', 'Shoulder Flexion — Unilateral Left', 'Left Arm Raise', 'shoulder_flexion',
 'Raise your left arm forward and upward to the prescribed height, keeping the elbow straight. Lower slowly and with control.', 'Improve left shoulder flexion range of motion and strength.',
 6, 2000, 1000, 70, false,
 '{"hold": ["Hold it there.", "Hold there.", "Stay there.", "Good, hold.", "Keep it up."], "intro": "Raise your left arm to shoulder height.", "lower": "Lower slowly.", "success_first": "Good work.", "correction_hold": "Hold for the full duration.", "success_rotating": ["Good.", "That is it.", "Well done.", "Keep it up.", "Nice work."], "correction_height": "Lift a little higher.", "exercise_complete": "Good work on that set.", "correction_balance": "Keep your posture steady.", "correction_isolation": "Keep the other arm still."}'::jsonb,
 '{"key_landmarks": ["left_shoulder", "left_elbow", "left_wrist"], "primary_metric": "leftArmElevationDeg", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb,
 'sagittal', 'unilateral_left', 'encouraging', 'balanced', 0, 160, 180, 110, 'standing', 'side', 'degrees', 'upper_body'),

('c0969a32-1633-4816-a744-0c697122eceb', true, 'shoulder_flexion_right', 'Shoulder Flexion — Unilateral Right', 'Right Arm Raise', 'shoulder_flexion',
 'Raise your right arm forward and upward to the prescribed height, keeping the elbow straight. Lower the arm slowly and with control.', 'Improve right shoulder flexion range of motion and strength.',
 6, 2000, 1000, 70, false,
 '{"hold": ["Hold it there.", "Hold there.", "Stay there.", "Good, hold.", "Keep it up."], "intro": "Raise your right arm to shoulder height.", "lower": "Lower slowly.", "success_first": "Good work.", "correction_hold": "Hold for the full duration.", "success_rotating": ["Good.", "That is it.", "Well done.", "Keep it up.", "Nice work."], "correction_height": "Lift a little higher.", "exercise_complete": "Good work on that set.", "correction_balance": "Keep your posture steady.", "correction_isolation": "Keep the other arm still."}'::jsonb,
 '{"key_landmarks": ["right_shoulder", "right_elbow", "right_wrist"], "primary_metric": "rightArmElevationDeg", "bilateral_check": false, "threshold_degrees": 70, "confidence_minimum": 0.7}'::jsonb,
 'sagittal', 'unilateral_right', 'encouraging', 'balanced', 0, 160, 180, 110, 'standing', 'side', 'degrees', 'upper_body'),

('81ce3445-0e47-45b3-bbdd-223e885aa760', true, 'sit_to_stand', 'Sit to Stand Transfer', 'Sit to Stand ', 'sit_to_stand',
 'From a seated position, rise to standing using your leg strength. Avoid pushing off with your arms. Hold 2 seconds. Return to seated slowly and with control', 'Improve lower limb strength, balance and functional mobility.',
 6, 3000, 1500, 160, false,
 '{"hold": ["Hold standing.", "Stay standing.", "Good, hold there.", "Keep it up.", "Hold that position."], "intro": "Rise from your seat to standing.", "lower": "Sit back down slowly.", "success_first": "Good first rep.", "correction_hold": "Hold the standing position.", "success_rotating": ["Good.", "That is it.", "Well done.", "Keep going.", "Strong."], "correction_height": "Stand up fully.", "exercise_complete": "Good work on that set.", "correction_balance": "Keep your balance steady.", "correction_isolation": "Use your legs, not your arms."}'::jsonb,
 '{"key_landmarks": ["left_hip", "left_knee", "left_ankle", "right_hip", "right_knee", "right_ankle"], "primary_metric": "kneeExtensionDeg", "bilateral_check": false, "threshold_degrees": 160, "confidence_minimum": 0.6}'::jsonb,
 'sagittal', 'centre', 'encouraging', 'balanced', 90, 160, 180, 80, 'seated', 'side', 'degrees', 'full_body')
on conflict (id) do nothing;
