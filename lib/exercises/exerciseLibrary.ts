import { ExerciseDefinition } from "@/lib/types/exercise";

export const EXERCISE_LIBRARY: ExerciseDefinition[] = [
  {
    id: "right-arm-raise",
    name: "Right Arm Raise",
    description: "Lift your right arm and lower slowly.",
    repTarget: 6,
    movementGoal: "Shoulder flexion",
    primarySide: "right",
    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30
  },
  {
    id: "left-arm-raise",
    name: "Left Arm Raise",
    description: "Lift your left arm and lower slowly.",
    repTarget: 6,
    movementGoal: "Shoulder flexion",
    primarySide: "left",
    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30
  },
  {
    id: "both-arm-raise",
    name: "Both Arm Raise",
    description: "Lift both arms and lower slowly.",
    repTarget: 6,
    movementGoal: "Bilateral shoulder flexion",
    primarySide: "bilateral",
    startThresholdDeg: 25,
    targetThresholdDeg: 70,
    finishThresholdDeg: 30
  }
];
