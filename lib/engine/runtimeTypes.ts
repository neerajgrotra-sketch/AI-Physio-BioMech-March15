import type { MovementPhase, ExercisePrescription } from "@/lib/types/exercise";

export type RepFailureReason =
  | "failed_hold"
  | "failed_height"
  | "failed_balance"
  | "failed_isolation"
  | "failed_bilateral_participation"
  // Raised the wrong way, e.g. out to the side in a forward raise.
  | "failed_form"
  // Bent elbow at the target in a straight-arm exercise.
  | "failed_straight_arm"
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
  /** The arm was at the target height but the wrong way (e.g. out to the side) during this rep. */
  everBadForm?: boolean;
  /** When the form went wrong during a hold (a short slip is forgiven). */
  formBadSinceMs?: number | null;
  /** Hold time banked before a form slip paused it (resumes, doesn't restart). */
  heldBeforeSlipMs?: number | null;
  /** Which form problem kept the hold from running: out to the side, or a bent elbow. */
  badFormKind?: "plane" | "elbow" | null;
  /** Plane readings while this lift climbed through mid-range (lib/interpreter/liftPath.ts). */
  liftPath?: number[];

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
