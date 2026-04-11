import type { BuilderFormValues } from "@/lib/prescriptions/builderTypes";

export const DEFAULT_RAISE_BUILDER_VALUES: BuilderFormValues = {
  id: "custom-right-arm-raise",
  name: "Custom Right Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  side: "right",
  posture: "either",

  description: "Lift your right arm to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  targetMetric: "rightArmElevationDeg",
  targetLabel: "shoulder height",
  targetTolerance: 10,

  holdRequired: true,
  holdDurationMs: 2000,

  tempoLabel: "slow and controlled",

  maxTorsoLeanDeg: 18,
  maxShoulderTiltDeg: 15,
  maxOppositeArmElevationDeg: 35,

  cueIntro: "Begin when ready.",
  cueLift: "Lift your right arm to shoulder height.",
  cueHold: "Hold at the top.",
  cueLower: "Lower with control.",
  cueSuccess: "Good repetition.",
  cueFailedHeight:
    "That rep did not count. Lift your right arm a little higher and try again.",
  cueFailedHold:
    "That rep did not count. Hold a little longer at the top and try again.",
  cueFailedBalance:
    "That rep did not count. Try to stay upright and balanced.",
  cueFailedIsolation:
    "That rep did not count. Keep your left arm relaxed at your side and raise only your right arm.",
  cueFailedBilateralParticipation:
    "That rep did not count. Lift both arms to shoulder height together.",
  cueLiveIsolation: "Keep your left arm relaxed at your side.",
  cueLiveBilateral: "Lift both arms together."
};
