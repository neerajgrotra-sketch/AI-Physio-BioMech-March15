export type ExercisePhase = "ready" | "lifting" | "top" | "lowering" | "completed";

export type ExerciseDefinition = {
  id: string;
  name: string;
  description: string;
  repTarget: number;
  movementGoal: string;
  primarySide: "left" | "right" | "bilateral";
  startThresholdDeg: number;
  targetThresholdDeg: number;
  finishThresholdDeg: number;
};
