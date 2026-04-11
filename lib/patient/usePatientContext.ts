// ============================================================
// lib/patient/usePatientContext.ts
// ============================================================
// React hook that manages patient profile and exercise
// session context throughout a session.
//
// SessionRunner calls this hook and uses it to:
// - Track rep outcomes and update sentiment/fatigue
// - Record cue history so AI can see what was already tried
// - Build the full context object for every AI call
// - Assemble the session summary input at session end
//
// This is the memory of the session.
// The AI reads from this on every coaching decision.
// ============================================================

import { useRef, useCallback } from "react";

import type {
  PatientProfile,
  ExerciseSessionContext,
  CueRecord,
  CueOutcome,
  SessionSummaryInput,
  FatigueLevel,
  SessionSentiment
} from "@/lib/patient/patientTypes";

import {
  createExerciseSessionContext,
  deriveFatigueLevel,
  deriveSessionSentiment,
  createDefaultPatientProfile
} from "@/lib/patient/patientTypes";

import type { ExercisePrescription } from "@/lib/types/exercise";

// ============================================================
// INTERNAL STATE
// ============================================================

type PatientContextState = {
  patientProfile: PatientProfile;
  currentExerciseContext: ExerciseSessionContext | null;
  completedExercises: ExerciseSessionContext[];
  sessionStartedAtMs: number | null;

  // Raw outcome history for sentiment derivation
  recentRepOutcomes: Array<"success" | "failed">;

  // Hold duration history for fatigue derivation
  holdDurationHistory: number[];

  // When did the last rep complete (for hesitation detection)
  lastRepCompletedAtMs: number | null;
};

function createInitialState(
  patientProfile: PatientProfile
): PatientContextState {
  return {
    patientProfile,
    currentExerciseContext: null,
    completedExercises: [],
    sessionStartedAtMs: null,
    recentRepOutcomes: [],
    holdDurationHistory: [],
    lastRepCompletedAtMs: null
  };
}

// ============================================================
// HOOK
// ============================================================

export function usePatientContext(
  initialProfile?: Partial<PatientProfile>
) {
  const profile: PatientProfile = {
    ...createDefaultPatientProfile(),
    ...initialProfile
  };

  const stateRef = useRef<PatientContextState>(
    createInitialState(profile)
  );

  // ----------------------------------------------------------
  // SESSION LIFECYCLE
  // ----------------------------------------------------------

  const beginSession = useCallback(() => {
    stateRef.current = {
      ...stateRef.current,
      completedExercises: [],
      sessionStartedAtMs: Date.now(),
      recentRepOutcomes: [],
      holdDurationHistory: [],
      lastRepCompletedAtMs: null
    };
  }, []);

  // ----------------------------------------------------------
  // EXERCISE LIFECYCLE
  // ----------------------------------------------------------

  const beginExercise = useCallback(
    (
      prescription: ExercisePrescription,
      exerciseIndexInSession: number,
      totalExercisesInSession: number
    ) => {
      const context = createExerciseSessionContext(
        prescription.id,
        prescription.name,
        exerciseIndexInSession,
        totalExercisesInSession,
        prescription.repTarget,
        stateRef.current.patientProfile
      );

      stateRef.current = {
        ...stateRef.current,
        currentExerciseContext: context,
        recentRepOutcomes: [],
        holdDurationHistory: [],
        lastRepCompletedAtMs: null
      };
    },
    []
  );

  const completeExercise = useCallback(() => {
    const { currentExerciseContext, completedExercises } = stateRef.current;
    if (!currentExerciseContext) return;

    stateRef.current = {
      ...stateRef.current,
      completedExercises: [...completedExercises, currentExerciseContext],
      currentExerciseContext: null
    };
  }, []);

  // ----------------------------------------------------------
  // REP OUTCOME RECORDING
  // ----------------------------------------------------------
  // Call after each rep completes or fails.
  // Updates sentiment, fatigue, and failure reason tallies.
  // ----------------------------------------------------------

  const recordRepOutcome = useCallback(
    (
      outcome: "success" | "failed",
      failureReason: string | null,
      holdDurationMs: number | null
    ) => {
      const state = stateRef.current;
      if (!state.currentExerciseContext) return;

      const nowMs = Date.now();

      // Update outcome history
      const recentRepOutcomes = [
        ...state.recentRepOutcomes.slice(-4),
        outcome
      ];

      // Update hold duration history
      const holdDurationHistory =
        holdDurationMs !== null
          ? [...state.holdDurationHistory.slice(-4), holdDurationMs]
          : state.holdDurationHistory;

      // Derive fatigue and sentiment
      const ctx = state.currentExerciseContext;

      const fatigueLevel: FatigueLevel = deriveFatigueLevel(
        holdDurationHistory,
        ctx.repTarget > 0 ? 2000 : 0, // use prescription hold duration ideally
        ctx.failedReps + (outcome === "failed" ? 1 : 0)
      );

      const hesitationMs = state.lastRepCompletedAtMs
        ? nowMs - state.lastRepCompletedAtMs
        : 0;

      const sentiment: SessionSentiment = deriveSessionSentiment(
        recentRepOutcomes,
        hesitationMs
      );

      // Update failure reason tallies
      const failureReasons = { ...ctx.failureReasons };
      if (outcome === "failed" && failureReason) {
        if (failureReason === "failed_height") failureReasons.height += 1;
        else if (failureReason === "failed_hold") failureReasons.hold += 1;
        else if (failureReason === "failed_balance") failureReasons.balance += 1;
        else if (failureReason === "failed_isolation") failureReasons.isolation += 1;
        else if (failureReason === "failed_bilateral_participation")
          failureReasons.bilateral += 1;
      }

      const updatedContext: ExerciseSessionContext = {
        ...ctx,
        repCount: outcome === "success" ? ctx.repCount + 1 : ctx.repCount,
        successfulReps:
          outcome === "success" ? ctx.successfulReps + 1 : ctx.successfulReps,
        failedReps:
          outcome === "failed" ? ctx.failedReps + 1 : ctx.failedReps,
        failureReasons,
        fatigueLevel,
        sentiment
      };

      stateRef.current = {
        ...state,
        currentExerciseContext: updatedContext,
        recentRepOutcomes,
        holdDurationHistory,
        lastRepCompletedAtMs: outcome === "success" ? nowMs : state.lastRepCompletedAtMs
      };
    },
    []
  );

  // ----------------------------------------------------------
  // CUE HISTORY MANAGEMENT
  // ----------------------------------------------------------
  // Call when a coaching cue is delivered.
  // Returns the cue ID so you can later update its outcome.
  // ----------------------------------------------------------

  const recordCueDelivered = useCallback(
    (
      text: string,
      triggerPattern: string
    ): string => {
      const state = stateRef.current;
      if (!state.currentExerciseContext) return "";

      const cueId = `cue-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

      const cue: CueRecord = {
        id: cueId,
        deliveredAtMs: Date.now(),
        deliveredAtRep: state.currentExerciseContext.repCount,
        text,
        triggerPattern,
        outcome: "pending"
      };

      stateRef.current = {
        ...state,
        currentExerciseContext: {
          ...state.currentExerciseContext,
          cueHistory: [
            ...state.currentExerciseContext.cueHistory,
            cue
          ]
        }
      };

      return cueId;
    },
    []
  );

  const updateCueOutcome = useCallback(
    (cueId: string, outcome: CueOutcome) => {
      const state = stateRef.current;
      if (!state.currentExerciseContext) return;

      const updatedHistory = state.currentExerciseContext.cueHistory.map(
        (cue) =>
          cue.id === cueId ? { ...cue, outcome } : cue
      );

      stateRef.current = {
        ...state,
        currentExerciseContext: {
          ...state.currentExerciseContext,
          cueHistory: updatedHistory
        }
      };
    },
    []
  );

  // ----------------------------------------------------------
  // GETTERS
  // ----------------------------------------------------------

  const getPatientProfile = useCallback((): PatientProfile => {
    return stateRef.current.patientProfile;
  }, []);

  const getCurrentExerciseContext =
    useCallback((): ExerciseSessionContext | null => {
      return stateRef.current.currentExerciseContext;
    }, []);

  // ----------------------------------------------------------
  // SESSION SUMMARY INPUT BUILDER
  // ----------------------------------------------------------
  // Called at session end to assemble everything Claude needs
  // to generate a clinical session summary.
  // ----------------------------------------------------------

  const buildSessionSummaryInput = useCallback((): SessionSummaryInput | null => {
    const state = stateRef.current;
    if (!state.sessionStartedAtMs) return null;

    const allExercises = [
      ...state.completedExercises,
      ...(state.currentExerciseContext
        ? [state.currentExerciseContext]
        : [])
    ];

    if (allExercises.length === 0) return null;

    const totalDurationMs = Date.now() - state.sessionStartedAtMs;

    // Build sentiment trajectory from exercise sentiments
    const overallSentimentTrajectory = allExercises.map(
      (ex) => ex.sentiment
    );

    return {
      patientProfile: state.patientProfile,
      exercises: allExercises,
      totalDurationMs,
      overallSentimentTrajectory
    };
  }, []);

  // ----------------------------------------------------------
  // UPDATE PATIENT PROFILE
  // Called from session setup UI when patient type is selected
  // ----------------------------------------------------------

  const updatePatientProfile = useCallback(
    (updates: Partial<PatientProfile>) => {
      stateRef.current = {
        ...stateRef.current,
        patientProfile: {
          ...stateRef.current.patientProfile,
          ...updates
        }
      };
    },
    []
  );

  return {
    // Lifecycle
    beginSession,
    beginExercise,
    completeExercise,

    // Rep tracking
    recordRepOutcome,

    // Cue tracking
    recordCueDelivered,
    updateCueOutcome,

    // Getters
    getPatientProfile,
    getCurrentExerciseContext,

    // Session summary
    buildSessionSummaryInput,

    // Profile management
    updatePatientProfile
  };
}
