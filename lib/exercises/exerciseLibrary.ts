import { ExerciseDefinition } from "@/lib/types/exercise";

export const EXERCISE_LIBRARY: ExerciseDefinition[] = [
  {
    id: "right-arm-raise",
    name: "Right Arm Raise",
    description: "Lift your right arm, hold briefly at the top, then lower slowly.",
    repTarget: 6,
    movementGoal: "Shoulder flexion",
    primarySide: "right",
    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30,
    requiresHold: true,
    holdDurationMs: 1500,
    topToleranceDeg: 10
  },
  {
    id: "left-arm-raise",
    name: "Left Arm Raise",
    description: "Lift your left arm, hold briefly at the top, then lower slowly.",
    repTarget: 6,
    movementGoal: "Shoulder flexion",
    primarySide: "left",
    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30,
    requiresHold: true,
    holdDurationMs: 1500,
    topToleranceDeg: 10
  },
  {
    id: "both-arm-raise",
    name: "Both Arm Raise",
    description: "Lift both arms, hold briefly at the top, then lower slowly.",
    repTarget: 6,
    movementGoal: "Bilateral shoulder flexion",
    primarySide: "bilateral",
    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30,
    requiresHold: true,
    holdDurationMs: 1500,
    topToleranceDeg: 10
  }
];
