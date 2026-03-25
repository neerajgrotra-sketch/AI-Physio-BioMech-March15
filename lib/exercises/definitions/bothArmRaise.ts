import type { ExercisePrescription } from "@/lib/types/exercise";

export const bothArmRaisePrescription: ExercisePrescription = {
  id: "both-arm-raise",
  name: "Both Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "both",
  posture: "either",
  description: "Lift both arms to shoulder height, hold, then lower slowly.",

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
    intro: "Begin when ready.",
    lift: "Lift both arms to shoulder height.",
    hold: "Hold at the top.",
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
    liveBilateralCue: "Lift both arms together."
  },

  framing: {
    intent:
      "Measure bilateral arm elevation simultaneously. Both arms must be equally visible to detect asymmetry and bilateral participation. Patient centering is critical.",
    landmarks: {
      critical: [
        "right_shoulder",
        "left_shoulder",
        "right_wrist",
        "left_wrist"
      ],
      supporting: ["right_elbow", "left_elbow", "nose"],
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
