// ============================================================
// lib/types/exercise.ts
// ============================================================
// Core exercise type definitions.
// Module 1 addition: FramingDeclaration — exercise-aware
// camera framing intelligence schema.
// ============================================================

export type ExerciseCategory =
  | "upper_body"
  | "lower_body"
  | "transfer"
  | "balance"
  | "core";

export type ExerciseSide = "left" | "right" | "both" | "center";

export type ExercisePosture = "seated" | "standing" | "either";

export type ExerciseTemplate = "raise_hold_lower" | "rise_hold_lower";

export type ExerciseRuntimeStatus = "active" | "draft" | "disabled";

export type MovementPhase =
  | "idle"
  | "ready"
  | "lifting"
  | "top"
  | "holding"
  | "lowering"
  | "bottom"
  | "complete"
  | "unknown";

export type MetricSource =
  // Shoulder flexion (sagittal plane)
  | "rightArmElevationDeg"
  | "leftArmElevationDeg"
  | "bilateralArmElevationDeg"
  // Shoulder abduction (frontal plane)
  | "rightShoulderAbductionDeg"
  | "leftShoulderAbductionDeg"
  | "bilateralShoulderAbductionDeg"
  // Elbow
  | "rightElbowAngleDeg"
  | "leftElbowAngleDeg"
  // Posture
  | "torsoLeanDeg"
  | "shoulderTiltDeg"
  | "rightWristToShoulderDy"
  | "leftWristToShoulderDy"
  // Hip / transfer
  | "hipCenterY"
  | "hipHeightNormalized"
  | "hipCenterVelocityY"
  | "kneeToHipExtensionScore"
  // Wrist overhead
  | "rightWristAboveShoulder"
  | "leftWristAboveShoulder"
  // Knee
  | "rightKneeExtensionDeg"
  | "leftKneeExtensionDeg";

// ============================================================
// FRAMING DECLARATION — Module 1
// ============================================================
// Describes exactly what the camera needs to see to make
// this exercise's measurements valid. Used by the framing
// monitor and the AI framing evaluator.
// ============================================================

export type FramingLandmarkTier = {
  // Exercise measurement fails without these.
  // Loss for > 1500ms triggers exercise pause (between reps).
  critical: string[];

  // Measurement quality degrades without these.
  // Loss triggers a warning only — exercise continues.
  supporting: string[];

  // Useful context but not required for core measurement.
  reference: string[];
};

export type FramingConfidenceThresholds = {
  // Critical landmarks below this = lost
  critical: number;

  // Supporting landmarks below this = weak
  supporting: number;
};

export type FramingPeakMovementZone =
  | "shoulder_height"
  | "above_head"
  | "hip_level"
  | "standing_full"
  | "knee_extension";

export type FramingDeclaration = {
  // What the camera must capture for measurement to be valid.
  // This is fed directly into the AI framing prompt.
  intent: string;

  // Landmarks split by clinical importance
  landmarks: FramingLandmarkTier;

  // Minimum confidence scores per tier
  confidenceThresholds: FramingConfidenceThresholds;

  // Minimum body coverage required in frame
  requiredCoverage: "upper_body" | "lower_body" | "torso_and_hips" | "full_body";

  // Where the movement reaches at its peak.
  // Used to check if there is enough headroom in frame.
  peakMovementZone: FramingPeakMovementZone;

  // The posture the patient must be in before starting
  requiredStartPosture: ExercisePosture;

  // Whether both sides need equal visibility.
  // True for bilateral exercises — asymmetric visibility
  // produces false measurement failures.
  bilateralSymmetryRequired: boolean;

  // Camera angle guidance for the AI evaluator.
  // Explains what angle is needed and why.
  angleGuidance: string;

  // What goes wrong clinically if framing is inadequate.
  // Used by AI to generate specific patient instructions.
  measurementRisk: string;
};

// ============================================================
// COACHING STRINGS
// ============================================================
// Deterministic fallback text per scenario.
// Used when AI is unavailable or timed out.
// Also used as the baseline instruction panel text.
// ============================================================

export type ExerciseCoachingStrings = {
  intro: string;
  lift: string;
  hold: string;              // single string — kept for backward compat
  holdVariants?: string[];   // full array from DB coaching_strings.hold
  lower: string;
  success: string;              // single string — kept for backward compat
  successVariants?: string[];   // full array from DB coaching_strings.success_rotating
  successFirst?: string;        // from DB coaching_strings.success_first
  exerciseComplete?: string;    // from DB coaching_strings.exercise_complete
  failedHeight: string;
  failedHold: string;
  failedBalance: string;
  failedIsolation?: string;
  failedBilateralParticipation?: string;
  liveIsolationCue?: string;
  liveBilateralCue?: string;
};

// ============================================================
// EXERCISE PRESCRIPTION
// ============================================================

export type ExercisePrescription = {
  id: string;
  name: string;
  category: ExerciseCategory;
  template: ExerciseTemplate;
  runtimeStatus: ExerciseRuntimeStatus;
  side: ExerciseSide;
  posture: ExercisePosture;
  description: string;

  repTarget: number;

  // Movement thresholds (in metric units, e.g. degrees)
  startThreshold: number;
  targetThreshold: number;
  finishThreshold: number;

  target: {
    metric: MetricSource;
    label: string;
    targetValue: number;
    tolerance?: number;
  };

  hold: {
    required: boolean;
    durationMs: number;
  };

  tempo: {
    label: string;
  };

  qualityLimits?: {
    maxTorsoLeanDeg?: number;
    maxShoulderTiltDeg?: number;
    maxOppositeArmElevationDeg?: number;
  };

  // Deterministic coaching strings — used as fallbacks
  // when AI is unavailable
  coaching: ExerciseCoachingStrings;

  // Exercise-aware framing intelligence declaration
  // Added in Module 1
  framing: FramingDeclaration;
};

export type ExerciseDefinitionId =
  | "right-arm-raise"
  | "left-arm-raise"
  | "both-arm-raise"
  | "sit-to-stand";
