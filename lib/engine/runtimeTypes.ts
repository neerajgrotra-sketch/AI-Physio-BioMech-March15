import type { MovementPhase, ExercisePrescription } from "@/lib/types/exercise";

export type RepFailureReason =
  | "failed_hold"
  | "failed_height"
  | "failed_balance"
  | "failed_isolation"
  | "failed_bilateral_participation"
  // Raised the wrong way, e.g. out to the side in a forward raise.
  | "failed_form"
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
  enteredLoweringAtMs: number | null;  // used to gate re-raise escape
  holdSatisfied: boolean;
  hasDescendedFromPeak: boolean;       // true once metric drops below target during LOWERING
  everReachedTarget: boolean;

  everViolatedIsolation: boolean;
  everHadBilateralParticipationGap: boolean;

  // When the metric first dipped below the hold floor during HOLDING
  // (null when it has not). See HOLD_DIP_GRACE_MS.
  dipStartedAtMs?: number | null;

  // Highest metric value of the current lift (LIFTING only).
  attemptPeak?: number | null;
  /** Where the opposite arm rests (updated while ready), for the isolation check. */
  oppositeRest?: number | null;
  /** The arm went the wrong way (e.g. out to the side) during this rep. */
  everBadForm?: boolean;

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
