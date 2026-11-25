// ============================================================
// lib/sessions/buildSessionPrescription.ts
// ============================================================
// Maps an exercise_templates row (by slug) plus the per-session
// overrides to the ExercisePrescription the engine runs. Moved out of
// app/session/page.tsx so it can be tested against the real templates
// (lib/sessions/buildSessionPrescription.test.ts).
// ============================================================

import type { CameraPreference, ExercisePosture, ExercisePrescription } from '@/lib/types/exercise';
import { kneeExtensionThresholds } from '@/lib/exercises/kneeThresholds';

// ─── Prescription builder ─────────────────────────────────────────────────────
// Keyed on exercise_templates.slug (snake_case, e.g. shoulder_flexion_right).
// display_name from the DB is passed through as the patient-facing exercise name.
// clinical_name is used server-side only and not needed in the prescription payload.

export type TemplateSetup = {
  /** exercise_templates.camera_position: 'front' | 'side' | 'either' */
  cameraPosition?: string | null;
  /** exercise_templates.patient_position: 'standing' | 'seated' | 'either' */
  patientPosition?: string | null;
};

const CAMERAS: CameraPreference[] = ['front', 'side', 'either'];
const POSTURES: ExercisePosture[] = ['standing', 'seated', 'either'];

/**
 * The prescription for a template, with the physio's Clinical Setup from
 * the exercise library applied: camera_position becomes `camera`, and
 * patient_position the posture the positioning coach asks for (arm
 * exercises only: knee extension and sit to stand always start seated).
 */
export function buildPrescription(
  slug: string,
  displayName: string,
  repOverride: number,
  holdMsOverride: number,
  coachingStrings: Record<string, unknown>,
  romStart: number | null = null,
  romNorm: number | null = null,
  romAcceptableMin: number | null = null,
  romTargetDegrees: number | null = null,
  romEncourageDegrees: number | null = null,
  setup: TemplateSetup = {},
): ExercisePrescription | null {
  const p = buildBase(slug, displayName, repOverride, holdMsOverride, coachingStrings, romStart, romNorm, romAcceptableMin, romTargetDegrees, romEncourageDegrees);
  if (!p) return null;
  const cam = setup.cameraPosition as CameraPreference;
  if (CAMERAS.includes(cam)) p.camera = cam;
  const posture = setup.patientPosition as ExercisePosture;
  if (p.category === 'upper_body' && POSTURES.includes(posture)) {
    p.posture = posture;
    if (p.framing) p.framing.requiredStartPosture = posture;
  }
  return p;
}

function buildBase(
  slug: string,
  displayName: string,
  repOverride: number,
  holdMsOverride: number,
  coachingStrings: Record<string, unknown>,
  romStart: number | null = null,
  romNorm: number | null = null,
  romAcceptableMin: number | null = null,
  romTargetDegrees: number | null = null,
  romEncourageDegrees: number | null = null,
): ExercisePrescription | null {
  const hold = {
    required: holdMsOverride > 0,
    durationMs: holdMsOverride,
  };

  // ── ROM-driven thresholds ──────────────────────────────────────────────────
  // Derived from DB values so every exercise uses clinically correct targets.
  // startThreshold:  just above rest position — triggers rep detection
  // targetThreshold: minimum degrees for a rep to count (rom_acceptable_min)
  // finishThreshold: back near rest — ends the rep cycle
  // targetValue:     the prescribed goal (rom_norm_degrees) — used by ghost + AI
  //
  // Note: these are PRE-calibration values. useInferenceLoop applies a dynamic
  // rest baseline offset during the first 2s of each exercise, overwriting
  // startThreshold, targetThreshold, finishThreshold on the prescription object.
  //
  // For descending metrics (knee extension: 90° → 0°), values invert in the
  // interpreter — we pass the DB values as-is and let the state machine handle it.
  const _romStart = romStart ?? 0;
  const _romNorm = romNorm ?? 160;
  const _romMin = romAcceptableMin ?? 110;
  const startThresh = _romStart + 15;
  // Physio override wins over population-level rom_acceptable_min
  const targetThresh = romTargetDegrees ?? _romMin;
  const finishThresh = _romStart + 20;

  // Knee extension: the templates store knee ROM as flexion (0 = straight);
  // the app measures the interior knee angle (180 = straight).
  const knee = kneeExtensionThresholds({
    romStartDegrees: romStart,
    romNormDegrees: romNorm,
    romAcceptableMin,
    romTargetDegrees,
  });

  // Extra fields passed through for calibration and debug logging
  // These are NOT part of ExercisePrescription type but are attached as extras
  // and accessed via (prescription as any).romAcceptableMin etc.
  const extraRomFields = {
    romAcceptableMin: _romMin,
    romNormDegrees: _romNorm,
    romStartDegrees: _romStart,
    // Physio-set patient-specific ROM target (null = use population default)
    romTargetDegrees: romTargetDegrees ?? null,
    // AI encourage-to target: if patient reaches targetThreshold, coach toward this
    encourageThreshold: romEncourageDegrees ?? null,
  };

  const holdRaw = coachingStrings.hold;
  const holdVariants: string[] = Array.isArray(holdRaw)
    ? (holdRaw as string[])
    : typeof holdRaw === 'string'
    ? [holdRaw]
    : ['Hold it there.'];
  const holdSingle = holdVariants[0] ?? 'Hold it there.';

  const successRaw = coachingStrings.success_rotating;
  const successVariants: string[] = Array.isArray(successRaw)
    ? (successRaw as string[])
    : typeof successRaw === 'string'
    ? [successRaw]
    : ['Good.'];
  const successSingle = successVariants[0] ?? 'Good.';

  const coaching = {
    intro: (coachingStrings.intro as string) ?? 'Begin when ready.',
    lift: (coachingStrings.lift as string) ?? 'Lift to the target position.',
    hold: holdSingle,
    holdVariants,
    lower: (coachingStrings.lower as string) ?? 'Lower slowly.',
    success: successSingle,
    successVariants,
    successFirst: (coachingStrings.success_first as string) ?? undefined,
    exerciseComplete: (coachingStrings.exercise_complete as string) ?? undefined,
    failedHeight:
      (coachingStrings.correction_height as string) ?? 'Lift a little higher.',
    failedHold:
      (coachingStrings.correction_hold as string) ?? 'Hold for the full duration.',
    failedBalance:
      (coachingStrings.correction_balance as string) ?? 'Keep your posture steady.',
    failedIsolation:
      (coachingStrings.correction_isolation as string) ?? undefined,
  };

  switch (slug) {
    // ── Shoulder Flexion (sagittal plane — arm forward and up) ───────────────
    case 'shoulder_flexion_right':
      return {
        id: 'shoulder_flexion_right',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'right',
        posture: 'either',
        description: 'Lift your right arm forward and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'rightArmElevationDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 10 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15, maxOppositeArmElevationDeg: 35 },
        coaching,
        framing: {
          intent: 'Measure right arm elevation arc in the sagittal plane from resting to shoulder height.',
          landmarks: { critical: ['right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['left_shoulder', 'nose', 'right_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Lateral or frontal view. Ensure the right arm and shoulder are clearly visible.',
          measurementRisk: 'Without clear visibility of right arm landmarks, elevation cannot be measured accurately.',
        },
        ...extraRomFields,
      };

    case 'shoulder_flexion_left':
      return {
        id: 'shoulder_flexion_left',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'left',
        posture: 'either',
        description: 'Lift your left arm forward and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'leftArmElevationDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 10 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15, maxOppositeArmElevationDeg: 35 },
        coaching,
        framing: {
          intent: 'Measure left arm elevation arc in the sagittal plane from resting to shoulder height.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist'], supporting: ['right_shoulder', 'nose', 'left_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Lateral or frontal view. Ensure the left arm and shoulder are clearly visible.',
          measurementRisk: 'Without clear visibility of left arm landmarks, elevation cannot be measured accurately.',
        },
        ...extraRomFields,
      };

    case 'shoulder_flexion_bilateral':
      return {
        id: 'shoulder_flexion_bilateral',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'both',
        posture: 'either',
        description: 'Lift both arms forward and up to shoulder height simultaneously, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'bilateralArmElevationDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 10 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15 },
        coaching,
        framing: {
          intent: 'Measure bilateral arm elevation simultaneously in the sagittal plane.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['nose', 'left_hip', 'right_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: true,
          angleGuidance: 'Frontal view required. Patient must be centred with both arms fully visible.',
          measurementRisk: 'Without bilateral landmark visibility, asymmetry cannot be detected.',
        },
        ...extraRomFields,
      };

    // ── Shoulder Abduction (frontal plane — arm out to the side and up) ──────
    case 'shoulder_abduction_right':
      return {
        id: 'shoulder_abduction_right',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'right',
        posture: 'either',
        description: 'Lift your right arm out to the side and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'rightShoulderAbductionDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 15, maxShoulderTiltDeg: 12, maxOppositeArmElevationDeg: 30 },
        coaching,
        framing: {
          intent: 'Measure right arm abduction arc in the frontal plane from resting to 90 degrees.',
          landmarks: { critical: ['right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['left_shoulder', 'right_hip', 'nose'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Frontal view essential. Patient must face the camera directly for accurate abduction measurement.',
          measurementRisk: 'Lateral camera angle will misrepresent frontal plane abduction. Frontal view required.',
        },
        ...extraRomFields,
      };

    case 'shoulder_abduction_left':
      return {
        id: 'shoulder_abduction_left',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'left',
        posture: 'either',
        description: 'Lift your left arm out to the side and up to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'leftShoulderAbductionDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 15, maxShoulderTiltDeg: 12, maxOppositeArmElevationDeg: 30 },
        coaching,
        framing: {
          intent: 'Measure left arm abduction arc in the frontal plane from resting to 90 degrees.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist'], supporting: ['right_shoulder', 'left_hip', 'nose'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Frontal view essential. Patient must face the camera directly for accurate abduction measurement.',
          measurementRisk: 'Lateral camera angle will misrepresent frontal plane abduction. Frontal view required.',
        },
        ...extraRomFields,
      };

    case 'shoulder_abduction_bilateral':
      return {
        id: 'shoulder_abduction_bilateral',
        name: displayName,
        category: 'upper_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'both',
        posture: 'either',
        description: 'Lift both arms out to the sides simultaneously to shoulder height, hold, then lower slowly.',
        repTarget: repOverride,
        startThreshold: startThresh,
        targetThreshold: targetThresh,
        finishThreshold: finishThresh,
        target: { metric: 'bilateralShoulderAbductionDeg', label: 'shoulder height', targetValue: _romNorm, tolerance: 12 },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 15, maxShoulderTiltDeg: 12 },
        coaching,
        framing: {
          intent: 'Measure bilateral arm abduction simultaneously in the frontal plane.',
          landmarks: { critical: ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'], supporting: ['nose', 'left_hip', 'right_hip'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'upper_body',
          peakMovementZone: 'shoulder_height',
          requiredStartPosture: 'either',
          bilateralSymmetryRequired: true,
          angleGuidance: 'Frontal view required. Patient must be centred with both arms fully visible.',
          measurementRisk: 'Without bilateral landmark visibility, asymmetry cannot be detected.',
        },
        ...extraRomFields,
      };

    // ── Sit to Stand (sagittal plane — transfer) ──────────────────────────────
    case 'sit_to_stand':
      return {
        id: 'sit_to_stand',
        name: displayName,
        category: 'transfer',
        template: 'rise_hold_lower',
        runtimeStatus: 'active',
        side: 'center',
        posture: 'seated',
        description: 'Rise to standing from seated, hold at full extension, then sit back down with control.',
        repTarget: repOverride,
        startThreshold: 100,
        targetThreshold: 170,
        finishThreshold: 120,
        target: { metric: 'kneeToHipExtensionScore', label: 'full standing', targetValue: 170, tolerance: 10 },
        hold: { required: holdMsOverride > 0, durationMs: holdMsOverride || 1000 },
        tempo: { label: 'slow and controlled' },
        coaching,
        framing: {
          intent: 'Detect hip transition from seated to full standing. Hip and knee landmarks must be visible throughout.',
          landmarks: { critical: ['left_hip', 'right_hip', 'left_knee', 'right_knee'], supporting: ['left_shoulder', 'right_shoulder', 'left_ankle', 'right_ankle'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'full_body',
          peakMovementZone: 'standing_full',
          requiredStartPosture: 'seated',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Side or frontal view. Full body must be visible from head to feet.',
          measurementRisk: 'Without hip and knee visibility, standing position cannot be confirmed.',
        },
        ...extraRomFields,
      };

    // ── Knee Extension (sagittal plane — seated) ──────────────────────────────
    case 'knee_extension_right':
      return {
        id: 'knee_extension_right',
        name: displayName,
        category: 'lower_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'right',
        posture: 'seated',
        description: 'Seated: straighten your right knee fully, hold at full extension, then lower slowly.',
        repTarget: repOverride,
        startThreshold: knee.startThreshold,
        targetThreshold: knee.targetThreshold,
        finishThreshold: knee.finishThreshold,
        target: { metric: 'rightKneeExtensionDeg', label: 'full extension', targetValue: knee.targetValue, tolerance: knee.tolerance },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 20 },
        coaching,
        framing: {
          intent: 'Measure right knee extension arc from seated flexion to full extension.',
          landmarks: { critical: ['right_hip', 'right_knee', 'right_ankle'], supporting: ['left_hip', 'left_knee', 'right_shoulder'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'lower_body',
          peakMovementZone: 'knee_extension',
          requiredStartPosture: 'seated',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Side view preferred. Right leg must be fully visible from hip to ankle.',
          measurementRisk: 'Without visibility of right knee and ankle, extension cannot be measured.',
        },
        ...extraRomFields,
      };

    case 'knee_extension_left':
      return {
        id: 'knee_extension_left',
        name: displayName,
        category: 'lower_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'left',
        posture: 'seated',
        description: 'Seated: straighten your left knee fully, hold at full extension, then lower slowly.',
        repTarget: repOverride,
        startThreshold: knee.startThreshold,
        targetThreshold: knee.targetThreshold,
        finishThreshold: knee.finishThreshold,
        target: { metric: 'leftKneeExtensionDeg', label: 'full extension', targetValue: knee.targetValue, tolerance: knee.tolerance },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 20 },
        coaching,
        framing: {
          intent: 'Measure left knee extension arc from seated flexion to full extension.',
          landmarks: { critical: ['left_hip', 'left_knee', 'left_ankle'], supporting: ['right_hip', 'right_knee', 'left_shoulder'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'lower_body',
          peakMovementZone: 'knee_extension',
          requiredStartPosture: 'seated',
          bilateralSymmetryRequired: false,
          angleGuidance: 'Side view preferred. Left leg must be fully visible from hip to ankle.',
          measurementRisk: 'Without visibility of left knee and ankle, extension cannot be measured.',
        },
        ...extraRomFields,
      };

    case 'knee_extension_bilateral':
      return {
        id: 'knee_extension_bilateral',
        name: displayName,
        category: 'lower_body',
        template: 'raise_hold_lower',
        runtimeStatus: 'active',
        side: 'both',
        posture: 'seated',
        description: 'Seated: straighten both knees simultaneously, hold at full extension, then lower slowly.',
        repTarget: repOverride,
        startThreshold: knee.startThreshold,
        targetThreshold: knee.targetThreshold,
        finishThreshold: knee.finishThreshold,
        target: { metric: 'bilateralKneeExtensionDeg', label: 'full extension', targetValue: knee.targetValue, tolerance: knee.tolerance },
        hold,
        tempo: { label: 'slow and controlled' },
        qualityLimits: { maxTorsoLeanDeg: 20 },
        coaching,
        framing: {
          intent: 'Measure bilateral knee extension from seated to full extension.',
          landmarks: { critical: ['left_hip', 'left_knee', 'right_hip', 'right_knee'], supporting: ['left_ankle', 'right_ankle', 'left_shoulder', 'right_shoulder'], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: 'lower_body',
          peakMovementZone: 'knee_extension',
          requiredStartPosture: 'seated',
          bilateralSymmetryRequired: true,
          angleGuidance: 'Side view, turned slightly toward the camera so both legs show. From the front a straightening leg moves toward the camera and the knee angle cannot be seen.',
          measurementRisk: 'Without both hips, knees and ankles in view, the knee angles cannot be measured.',
        },
        ...extraRomFields,
      };

    default:
      console.warn(`Unknown exercise slug: "${slug}" — skipping.`);
      return null;
  }
}
