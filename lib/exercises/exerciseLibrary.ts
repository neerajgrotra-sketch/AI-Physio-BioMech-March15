// ============================================================
// lib/exercises/exerciseLibrary.ts
// ============================================================
// Exercise prescriptions with full framing declarations.
// Module 1 addition: framing property on each prescription.
//
// Each prescription now declares:
// - Which landmarks are critical vs supporting vs reference
// - What camera coverage is required
// - What the clinical measurement risk is if framing fails
// - Camera angle guidance for AI framing evaluator
// ============================================================

import type { ExercisePrescription } from "@/lib/types/exercise";

// ============================================================
// RIGHT ARM RAISE
// ============================================================

export const RIGHT_ARM_RAISE: ExercisePrescription = {
  id: "right-arm-raise",
  name: "Right Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "right",
  posture: "either",
  description: "Lift your right arm to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "rightArmElevationDeg",
    label: "shoulder height",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "slow and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 18,
    maxShoulderTiltDeg: 15,
    maxOppositeArmElevationDeg: 35
  },

  coaching: {
    intro: "Begin when ready. Lift only your right arm.",
    lift: "Lift your right arm to shoulder height.",
    hold: "Hold it there.",
    lower: "Lower with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Lift your right arm a little higher and try again.",
    failedHold:
      "That rep did not count. Hold a little longer at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay upright and balanced.",
    failedIsolation:
      "That rep did not count. Keep your left arm relaxed at your side and raise only your right arm.",
    liveIsolationCue: "Keep your left arm relaxed at your side."
  },

  // ----------------------------------------------------------
  // FRAMING DECLARATION
  // ----------------------------------------------------------
  // Critical: right shoulder, elbow, wrist — the full arm
  //   arc must be visible to measure elevation accurately.
  // Supporting: left shoulder and nose — needed to detect
  //   torso compensation and bilateral isolation violations.
  // Reference: hips — useful for posture context only.
  // ----------------------------------------------------------
  framing: {
    intent:
      "Measure right arm elevation arc from resting position to shoulder height. Torso must be visible to detect compensation via trunk lean.",

    landmarks: {
      critical: ["right_shoulder", "right_elbow", "right_wrist"],
      supporting: ["left_shoulder", "nose", "right_hip"],
      reference: ["left_elbow", "left_wrist", "left_hip"]
    },

    confidenceThresholds: {
      critical: 0.5,
      supporting: 0.35
    },

    requiredCoverage: "upper_body",
    peakMovementZone: "shoulder_height",
    requiredStartPosture: "either",
    bilateralSymmetryRequired: false,

    angleGuidance:
      "Frontal view is essential. A side-on camera angle will not capture the arm elevation arc correctly and will produce inaccurate measurements.",

    measurementRisk:
      "If the right elbow or wrist are not clearly visible, arm elevation cannot be measured. If the left shoulder is not visible, isolation violations cannot be detected."
  }
};

// ============================================================
// LEFT ARM RAISE
// ============================================================

export const LEFT_ARM_RAISE: ExercisePrescription = {
  id: "left-arm-raise",
  name: "Left Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "left",
  posture: "either",
  description: "Lift your left arm to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "leftArmElevationDeg",
    label: "shoulder height",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "slow and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 18,
    maxShoulderTiltDeg: 15,
    maxOppositeArmElevationDeg: 35
  },

  coaching: {
    intro: "Begin when ready. Lift only your left arm.",
    lift: "Lift your left arm to shoulder height.",
    hold: "Hold it there.",
    lower: "Lower with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Lift your left arm a little higher and try again.",
    failedHold:
      "That rep did not count. Hold a little longer at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay upright and balanced.",
    failedIsolation:
      "That rep did not count. Keep your right arm relaxed at your side and raise only your left arm.",
    liveIsolationCue: "Keep your right arm relaxed at your side."
  },

  // ----------------------------------------------------------
  // FRAMING DECLARATION
  // ----------------------------------------------------------
  // Mirror of right arm raise but for the left side.
  // Critical landmarks are left-side arm chain.
  // Supporting includes right shoulder for isolation detection.
  // ----------------------------------------------------------
  framing: {
    intent:
      "Measure left arm elevation arc from resting position to shoulder height. Torso must be visible to detect compensation via trunk lean.",

    landmarks: {
      critical: ["left_shoulder", "left_elbow", "left_wrist"],
      supporting: ["right_shoulder", "nose", "left_hip"],
      reference: ["right_elbow", "right_wrist", "right_hip"]
    },

    confidenceThresholds: {
      critical: 0.5,
      supporting: 0.35
    },

    requiredCoverage: "upper_body",
    peakMovementZone: "shoulder_height",
    requiredStartPosture: "either",
    bilateralSymmetryRequired: false,

    angleGuidance:
      "Frontal view is essential. A side-on camera angle will not capture the arm elevation arc correctly and will produce inaccurate measurements.",

    measurementRisk:
      "If the left elbow or wrist are not clearly visible, arm elevation cannot be measured. If the right shoulder is not visible, isolation violations cannot be detected."
  }
};

// ============================================================
// BOTH ARM RAISE
// ============================================================

export const BOTH_ARM_RAISE: ExercisePrescription = {
  id: "both-arm-raise",
  name: "Both Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "both",
  posture: "either",
  description: "Lift both arms evenly to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "bilateralArmElevationDeg",
    label: "shoulder height",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "slow and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 18,
    maxShoulderTiltDeg: 15
  },

  coaching: {
    intro: "Begin when ready. Lift both arms together evenly.",
    lift: "Lift both arms to shoulder height.",
    hold: "Hold it there.",
    lower: "Lower with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Lift both arms a little higher and try again.",
    failedHold:
      "That rep did not count. Hold a little longer at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay upright and balanced.",
    failedBilateralParticipation:
      "That rep did not count. Lift both arms to shoulder height together.",
    liveBilateralCue: "Lift both arms together evenly."
  },

  // ----------------------------------------------------------
  // FRAMING DECLARATION
  // ----------------------------------------------------------
  // Both sides are critical — asymmetric visibility produces
  // false bilateral participation failures. This is the most
  // framing-sensitive exercise in the library.
  // Patient must be centered in frame.
  // ----------------------------------------------------------
  framing: {
    intent:
      "Measure bilateral arm elevation simultaneously. Both arms must be equally visible to detect asymmetry and bilateral participation. Patient centering is critical.",

    landmarks: {
      critical: [
        "right_shoulder",
        "left_shoulder",
        "right_elbow",
        "left_elbow",
        "right_wrist",
        "left_wrist"
      ],
      supporting: ["nose"],
      reference: ["right_hip", "left_hip"]
    },

    confidenceThresholds: {
      critical: 0.5,
      supporting: 0.35
    },

    requiredCoverage: "upper_body",
    peakMovementZone: "shoulder_height",
    requiredStartPosture: "either",
    bilateralSymmetryRequired: true,

    angleGuidance:
      "Patient must be centered in frame. If the patient is off-center, one arm will appear closer to the camera and produce false asymmetry readings. Frontal view only.",

    measurementRisk:
      "Unequal landmark visibility between left and right sides will cause false bilateral participation failures. Off-center positioning is the most common framing error for this exercise."
  }
};

// ============================================================
// SIT TO STAND
// ============================================================

export const SIT_TO_STAND: ExercisePrescription = {
  id: "sit-to-stand",
  name: "Sit to Stand",
  category: "transfer",
  template: "rise_hold_lower",
  runtimeStatus: "active",
  side: "center",
  posture: "either",
  description:
    "Stand up from a seated position, hold briefly, then sit back down slowly.",

  repTarget: 5,

  startThreshold: 110,
  targetThreshold: 155,
  finishThreshold: 120,

  target: {
    metric: "hipHeightNormalized",
    label: "full standing position",
    targetValue: 155,
    tolerance: 8
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "steady and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 25
  },

  coaching: {
    intro: "Begin seated. Stand up fully when ready, then sit back down slowly.",
    lift: "Stand up fully.",
    hold: "Hold that position.",
    lower: "Sit back down slowly.",
    success: "Good stand.",
    failedHeight:
      "That rep did not count. Stand up a little taller next time and try again.",
    failedHold:
      "That rep did not count. Hold your standing position a little longer and try again.",
    failedBalance:
      "That rep did not count. Try to stay balanced and controlled throughout."
  },

  // ----------------------------------------------------------
  // FRAMING DECLARATION
  // ----------------------------------------------------------
  // This is the most coverage-demanding exercise.
  // Hip and knee landmarks are critical — without them the
  // sit-to-stand transition cannot be detected at all.
  // Full body coverage required because the patient moves
  // from seated to fully standing.
  // Camera must be positioned low enough to see hips
  // when patient is seated.
  // ----------------------------------------------------------
  framing: {
    intent:
      "Detect hip transition from seated to full standing position. Hip and knee landmarks must be visible throughout the full movement arc from seated to standing.",

    landmarks: {
      critical: ["left_hip", "right_hip", "left_knee", "right_knee"],
      supporting: ["left_shoulder", "right_shoulder", "nose"],
      reference: ["left_ankle", "right_ankle"]
    },

    confidenceThresholds: {
      critical: 0.5,
      supporting: 0.35
    },

    requiredCoverage: "full_body",
    peakMovementZone: "standing_full",
    requiredStartPosture: "seated",
    bilateralSymmetryRequired: false,

    angleGuidance:
      "Camera must be placed low enough to see the patient's hips when they are seated. If the camera is at head height, hips will not be visible when seated and the stand transition cannot be detected. Aim for chest height or lower.",

    measurementRisk:
      "Without clear hip and knee visibility, the system cannot detect whether the patient has reached full standing position or returned to seated. The entire exercise measurement depends on these landmarks."
  }
};

// ============================================================
// LIBRARY EXPORTS
// ============================================================

export const EXERCISE_LIBRARY: ExercisePrescription[] = [
  RIGHT_ARM_RAISE,
  LEFT_ARM_RAISE,
  BOTH_ARM_RAISE,
  SIT_TO_STAND
];

export const ACTIVE_EXERCISE_LIBRARY: ExercisePrescription[] =
  EXERCISE_LIBRARY.filter(
    (exercise) => exercise.runtimeStatus === "active"
  );
