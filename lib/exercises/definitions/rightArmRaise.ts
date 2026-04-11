import type { ExercisePrescription } from "@/lib/types/exercise";

export const rightArmRaisePrescription: ExercisePrescription = {
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
    intro: "Begin when ready.",
    lift: "Lift your right arm to shoulder height.",
    hold: "Hold at the top.",
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
