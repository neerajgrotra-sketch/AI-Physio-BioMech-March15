import type { ExercisePrescription } from "@/lib/types/exercise";

export const sitToStandPrescription: ExercisePrescription = {
  id: "sit-to-stand",
  name: "Sit to Stand",
  category: "transfer",
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
    failedHeight: "That rep did not count. Stand up a little taller and try again.",
    failedHold: "That rep did not count. Pause briefly at the top and try again.",
    failedBalance: "That rep did not count. Try to stay balanced and controlled."
  }
};
