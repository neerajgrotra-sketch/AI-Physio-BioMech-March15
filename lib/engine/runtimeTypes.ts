import type { MovementPhase, ExercisePrescription } from "@/lib/types/exercise";

export type RepFailureReason =
  | "failed_hold"
  | "failed_height"
  | "failed_balance"
  | null;

export type RepEvaluation = {
  outcome: "success" | "failed" | "none";
  reason: RepFailureReason;
};

export type RuntimeRepState = {
  phase: MovementPhase;
  repCount: number;

  justCompletedRep: boolean;
  justFailedRep: boolean;
  justCompletedHold: boolean;

  enteredTopAtMs: number | null;
  holdSatisfied: boolean;
  everReachedTarget: boolean;

  lastRepEvaluation: RepEvaluation;
};

export type RuntimeFrameContext = {
  timestampMs: number;
  personDetected: boolean;
  balanceOk: boolean;
  activeMetricValue: number | null;
};

export type RuntimeEvaluationResult = {
  repState: RuntimeRepState;
  activeMetricValue: number | null;
  holdRemainingMs: number | null;
  isComplete: boolean;
};

export type PrescriptionRegistry = Record<string, ExercisePrescription>;
