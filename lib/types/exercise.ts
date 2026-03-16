export type ExercisePhase =
  | "ready"
  | "lifting"
  | "top"
  | "holding"
  | "lowering"
  | "completed";

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

  requiresHold: boolean;
  holdDurationMs: number;
  topToleranceDeg: number;
};
