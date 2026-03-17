import type { ExercisePrescription } from "@/lib/types/exercise";

export const leftArmRaisePrescription: ExercisePrescription = {
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
    intro: "Begin when ready.",
    lift: "Lift your left arm to shoulder height.",
    hold: "Hold at the top.",
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
  }
};
