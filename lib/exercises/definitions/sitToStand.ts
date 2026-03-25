import type { ExercisePrescription } from "@/lib/types/exercise";

export const sitToStandPrescription: ExercisePrescription = {
  id: "sit-to-stand",
  name: "Sit to Stand",
  category: "transfer",
  template: "rise_hold_lower",
  runtimeStatus: "planned",
  side: "center",
  posture: "either",
  description: "Stand up fully, pause briefly, then sit down with control.",

  repTarget: 5,

  startThreshold: 20,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "hipCenterY",
    label: "full standing position",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 1000
  },

  tempo: {
    label: "steady and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 25
  },

  coaching: {
    intro: "Begin when ready.",
    lift: "Stand up fully.",
    hold: "Pause at the top.",
    lower: "Sit down with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Stand up a little taller and try again.",
    failedHold:
      "That rep did not count. Pause briefly at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay balanced and controlled."
  },

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
