import type { ExercisePrescription } from "@/lib/types/exercise";

export const bothArmRaisePrescription: ExercisePrescription = {
  id: "both-arm-raise",
  name: "Both Arm Raise",
  category: "upper_body",
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
  }
};
