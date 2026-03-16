import { ExerciseDefinition } from "@/lib/types/exercise";

export const EXERCISE_LIBRARY: ExerciseDefinition[] = [
  {
    id: "right-arm-raise",

    name: "Right Arm Raise",

    description:
      "Lift your right arm to shoulder height, hold for 2 seconds, then lower slowly.",

    repTarget: 6,

    primarySide: "right",

    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30,

    requiresHold: true,
    holdDurationMs: 2000,
    topToleranceDeg: 10,

    targetLabel: "shoulder height"
  }
];
