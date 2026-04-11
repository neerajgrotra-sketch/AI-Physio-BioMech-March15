// ============================================================
// lib/coaching/clinicalContextAssembler.ts
// ============================================================
// Assembles the full clinical context object for every
// AI coaching decision.
//
// This is the bridge between fast movement data and the
// AI coaching brain. It answers the question:
// "Given everything we know about this person and this
// session right now — what should the AI be told?"
//
// Called by the coaching brain when:
// - ObservationBuffer produces a stable observation
// - A rep completes or fails
// - A hold phase starts
// - Hesitation is detected between reps
//
// The assembled context travels to Claude as a structured
// prompt. Claude reads it and decides:
// 1. Should I say something right now?
// 2. If yes, what exactly?
// 3. In what tone?
// ============================================================

import type { ExercisePrescription } from "@/lib/types/exercise";
import type { PatientProfile, ExerciseSessionContext } from "@/lib/patient/patientTypes";
import type { Observation } from "@/lib/coaching/types";
import type { FramingStatus } from "@/lib/framing/framingTypes";

// ============================================================
// COACHING TRIGGER
// ============================================================
// What caused the AI to be consulted right now.
// Shapes which prompt template is used.
// ============================================================

export type CoachingTrigger =
  | "rep_completed"           // successful rep just finished
  | "rep_failed"              // rep just failed with a reason
  | "hold_started"            // patient entered hold phase
  | "observation_ready"       // ObservationBuffer produced stable pattern
  | "hesitation_detected"     // patient stopped moving between reps
  | "exercise_started"        // first time entering this exercise
  | "exercise_completing";    // final rep just completed

// ============================================================
// COACHING SILENCE GATE
// ============================================================
// Tracks silence windows to prevent over-coaching.
// The AI should never speak more than once per window.
// ============================================================

export type SilenceGateState = {
  silentUntilMs: number;
  lastCoachingAtMs: number | null;
  lastCoachingTrigger: CoachingTrigger | null;
};

export function createSilenceGateState(): SilenceGateState {
  return {
    silentUntilMs: 0,
    lastCoachingAtMs: null,
    lastCoachingTrigger: null
  };
}

export function isSilenceWindowActive(
  gate: SilenceGateState,
  nowMs: number
): boolean {
  return nowMs < gate.silentUntilMs;
}

export function updateSilenceGate(
  gate: SilenceGateState,
  trigger: CoachingTrigger,
  nowMs: number
): SilenceGateState {
  // Silence windows per trigger type (ms)
  const silenceWindowMs: Record<CoachingTrigger, number> = {
    rep_completed:       2000,  // short — next rep starts in 3-5s anyway
    rep_failed:          1500,  // very short — patient may fail again quickly
    hold_started:        1000,  // minimal — deterministic cue anyway
    observation_ready:   8000,  // long — these are bonus cues
    hesitation_detected: 5000,  // medium
    exercise_started:    2000,  // short — first rep may come quickly
    exercise_completing: 3000
  };

  return {
    silentUntilMs: nowMs + silenceWindowMs[trigger],
    lastCoachingAtMs: nowMs,
    lastCoachingTrigger: trigger
  };
}

// ============================================================
// CLINICAL CONTEXT
// ============================================================
// The full context object sent to Claude.
// Every field is used by at least one prompt template.
// ============================================================

export type ClinicalContext = {
  // ---- WHO ----
  patientProfile: PatientProfile;

  // ---- WHAT EXERCISE ----
  prescription: {
    id: string;
    name: string;
    repTarget: number;
    holdRequired: boolean;
    holdDurationMs: number;
    targetMetricLabel: string;
    coachingStrings: {
      lift: string;
      hold: string;
      lower: string;
      success: string;
      failedHeight: string;
      failedHold: string;
      failedBalance: string;
      failedIsolation?: string;
    };
  };

  // ---- WHERE IN SESSION ----
  sessionPosition: {
    exerciseIndex: number;
    totalExercises: number;
    isFirstExercise: boolean;
    isLastExercise: boolean;
    repCount: number;
    repTarget: number;
    isFirstRep: boolean;
    isFinalRep: boolean;
  };

  // ---- HOW IT IS GOING ----
  performance: {
    successfulReps: number;
    failedReps: number;
    failureReasons: {
      height: number;
      hold: number;
      balance: number;
      isolation: number;
      bilateral: number;
    };
    fatigueLevel: string;
    sentiment: string;
    dominantFailureReason: string | null;
  };

  // ---- WHAT JUST HAPPENED ----
  trigger: {
    type: CoachingTrigger;
    failureReason: string | null;
    observation: Observation | null;
    holdElapsedMs: number | null;
    holdRequiredMs: number | null;
  };

  // ---- WHAT HAS ALREADY BEEN TRIED ----
  cueHistory: {
    totalCuesGiven: number;
    lastCueText: string | null;
    lastCueOutcome: string | null;
    lastCueTrigger: string | null;
    repeatedPattern: string | null; // pattern seen 3+ times
  };

  // ---- CURRENT MOMENT ----
  nowMs: number;
};

// ============================================================
// ASSEMBLER FUNCTION
// ============================================================

export function assembleClinicalContext(params: {
  prescription: ExercisePrescription;
  patientProfile: PatientProfile;
  exerciseContext: ExerciseSessionContext;
  trigger: CoachingTrigger;
  failureReason: string | null;
  observation: Observation | null;
  holdElapsedMs: number | null;
  holdRequiredMs: number | null;
  nowMs: number;
}): ClinicalContext {
  const {
    prescription,
    patientProfile,
    exerciseContext,
    trigger,
    failureReason,
    observation,
    holdElapsedMs,
    holdRequiredMs,
    nowMs
  } = params;

  // Determine dominant failure reason
  const { failureReasons } = exerciseContext;
  let dominantFailureReason: string | null = null;
  const maxFailures = Math.max(
    failureReasons.height,
    failureReasons.hold,
    failureReasons.balance,
    failureReasons.isolation,
    failureReasons.bilateral
  );
  if (maxFailures >= 2) {
    if (failureReasons.height === maxFailures) dominantFailureReason = "insufficient_height";
    else if (failureReasons.hold === maxFailures) dominantFailureReason = "insufficient_hold";
    else if (failureReasons.balance === maxFailures) dominantFailureReason = "balance";
    else if (failureReasons.isolation === maxFailures) dominantFailureReason = "isolation";
    else if (failureReasons.bilateral === maxFailures) dominantFailureReason = "bilateral_participation";
  }

  // Build cue history summary
  const cueHistory = exerciseContext.cueHistory;
  const lastCue = cueHistory[cueHistory.length - 1] ?? null;

  // Find any pattern seen 3+ times in cue history
  const patternCounts: Record<string, number> = {};
  for (const cue of cueHistory) {
    patternCounts[cue.triggerPattern] =
      (patternCounts[cue.triggerPattern] ?? 0) + 1;
  }
  const repeatedPattern =
    Object.entries(patternCounts).find(([, count]) => count >= 3)?.[0] ??
    null;

  // isFirstRep: true when this is the FIRST SUCCESSFUL rep completed
  // successfulReps === 1 means exactly one rep just succeeded (this one)
  // successfulReps === 0 means the rep that just completed is the first success
  // We check === 0 because successfulReps increments AFTER the callback fires
  const isFirstRep = exerciseContext.successfulReps === 0;
  const isFinalRep =
    exerciseContext.repCount === exerciseContext.repTarget - 1;

  return {
    patientProfile,

    prescription: {
      id: prescription.id,
      name: prescription.name,
      repTarget: prescription.repTarget,
      holdRequired: prescription.hold.required,
      holdDurationMs: prescription.hold.durationMs,
      targetMetricLabel: prescription.target.label,
      coachingStrings: {
        lift: prescription.coaching.lift,
        hold: prescription.coaching.hold,
        lower: prescription.coaching.lower,
        success: prescription.coaching.success,
        failedHeight: prescription.coaching.failedHeight,
        failedHold: prescription.coaching.failedHold,
        failedBalance: prescription.coaching.failedBalance,
        failedIsolation: prescription.coaching.failedIsolation
      }
    },

    sessionPosition: {
      exerciseIndex: exerciseContext.exerciseIndexInSession,
      totalExercises: exerciseContext.totalExercisesInSession,
      isFirstExercise: exerciseContext.exerciseIndexInSession === 0,
      isLastExercise:
        exerciseContext.exerciseIndexInSession ===
        exerciseContext.totalExercisesInSession - 1,
      repCount: exerciseContext.repCount,
      repTarget: exerciseContext.repTarget,
      isFirstRep,
      isFinalRep
    },

    performance: {
      successfulReps: exerciseContext.successfulReps,
      failedReps: exerciseContext.failedReps,
      failureReasons: exerciseContext.failureReasons,
      fatigueLevel: exerciseContext.fatigueLevel,
      sentiment: exerciseContext.sentiment,
      dominantFailureReason
    },

    trigger: {
      type: trigger,
      failureReason,
      observation,
      holdElapsedMs,
      holdRequiredMs
    },

    cueHistory: {
      totalCuesGiven: cueHistory.length,
      lastCueText: lastCue?.text ?? null,
      lastCueOutcome: lastCue?.outcome ?? null,
      lastCueTrigger: lastCue?.triggerPattern ?? null,
      repeatedPattern
    },

    nowMs
  };
}
