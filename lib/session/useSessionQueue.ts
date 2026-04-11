// ============================================================
// lib/session/useSessionQueue.ts
// ============================================================
// Manages the session exercise queue.
//
// Extracted from SessionRunner to give it a single
// responsibility: knowing which exercise is current,
// advancing the queue, and managing session lifecycle state.
//
// SessionRunner reads:
// - currentQueueItem       → the active exercise item
// - currentPrescription    → the active prescription
// - queueIndex             → position in queue
// - sessionStarted         → whether session is running
// - sessionComplete        → whether all exercises done
//
// SessionRunner calls:
// - buildQueue()           → before begin
// - beginSession()         → when Begin Session pressed
// - advanceQueue()         → when exercise completes
// - resetSession()         → when Reset pressed
// - endSession()           → when End pressed
// ============================================================

import { useState, useRef, useCallback, useMemo } from "react";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { TherapySession } from "@/lib/sessions/sessionTypes";

// ============================================================
// QUEUE ITEM TYPE
// ============================================================

export type QueueItem = {
  id: string;
  displayName: string;
  prescription: ExercisePrescription;
  seconds: number;
  sessionName: string;
};

// ============================================================
// HELPERS
// ============================================================

function estimateExerciseSeconds(
  prescription: ExercisePrescription
): number {
  const holdSec = prescription.hold.required
    ? prescription.hold.durationMs / 1000
    : 0;
  const repSeconds = Math.max(6, 4 + holdSec + 2);
  return prescription.repTarget * repSeconds;
}

function formatDurationRange(totalSeconds: number): string {
  const minMinutes = Math.max(1, Math.floor(totalSeconds / 60));
  const maxMinutes = Math.max(minMinutes, Math.ceil(totalSeconds / 60) + 1);
  if (minMinutes === maxMinutes) return `About ${minMinutes} min`;
  return `About ${minMinutes}–${maxMinutes} min`;
}

export function buildQueueFromSessions(
  sessions: TherapySession[],
  exercises: ExercisePrescription[]
): QueueItem[] {
  return sessions.flatMap((session) =>
    session.exercises
      .map((item) => {
        const prescription = exercises.find(
          (p) => p.id === item.prescriptionId
        );
        if (!prescription) return null;
        return {
          id: prescription.id,
          displayName: item.displayName,
          prescription,
          seconds: estimateExerciseSeconds(prescription),
          sessionName: session.name
        };
      })
      .filter((item): item is QueueItem => item !== null)
  );
}

export function inferSessionGoal(exerciseIds: string[]): string {
  const set = new Set(exerciseIds);
  if (
    set.has("right-arm-raise") ||
    set.has("left-arm-raise") ||
    set.has("both-arm-raise")
  ) {
    if (set.has("sit-to-stand"))
      return "Improve upper-body mobility, posture control, and functional movement.";
    return "Improve shoulder mobility, arm control, and upright posture.";
  }
  if (set.has("sit-to-stand"))
    return "Improve lower-body strength, transfer ability, and balance.";
  return "Support safe, guided rehabilitation movement.";
}

export { formatDurationRange, estimateExerciseSeconds };

// ============================================================
// HOOK
// ============================================================

export function useSessionQueue() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);

  // Refs for values read inside async loops
  const queueRef = useRef<QueueItem[]>([]);
  const queueIndexRef = useRef(0);
  const prescriptionRef = useRef<ExercisePrescription | null>(null);
  const advancePendingRef = useRef(false);
  const advanceTimeoutRef = useRef<number | null>(null);

  // ----------------------------------------------------------
  // COMPUTED
  // ----------------------------------------------------------

  const currentQueueItem = queueRef.current[queueIndexRef.current] ?? null;
  const currentPrescription = currentQueueItem?.prescription ?? null;

  // ----------------------------------------------------------
  // INTERNAL HELPERS
  // ----------------------------------------------------------

  function clearAdvanceTimeout() {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
  }

  // ----------------------------------------------------------
  // BEGIN SESSION
  // ----------------------------------------------------------

  const beginSession = useCallback(
    (queue: QueueItem[]) => {
      if (queue.length === 0) return false;

      clearAdvanceTimeout();
      queueRef.current = queue;
      queueIndexRef.current = 0;
      prescriptionRef.current = queue[0].prescription;
      advancePendingRef.current = false;

      setQueueIndex(0);
      setSessionStarted(true);
      setSessionComplete(false);

      return true;
    },
    []
  );

  // ----------------------------------------------------------
  // ADVANCE QUEUE
  // Called when an exercise completes.
  // Schedules the next exercise after a short pause.
  // onAdvanced callback fires when the new exercise is ready.
  // onComplete fires when the full queue is done.
  // ----------------------------------------------------------

  const advanceQueue = useCallback(
    (
      onAdvanced: (item: QueueItem, index: number) => void,
      onComplete: () => void
    ) => {
      if (advancePendingRef.current) return;
      advancePendingRef.current = true;

      const nextIndex = queueIndexRef.current + 1;
      const nextItem = queueRef.current[nextIndex] ?? null;

      if (nextItem) {
        clearAdvanceTimeout();
        advanceTimeoutRef.current = window.setTimeout(() => {
          queueIndexRef.current = nextIndex;
          prescriptionRef.current = nextItem.prescription;
          advancePendingRef.current = false;

          setQueueIndex(nextIndex);
          onAdvanced(nextItem, nextIndex);
        }, 1200);
      } else {
        advancePendingRef.current = false;
        setSessionComplete(true);
        onComplete();
      }
    },
    []
  );

  // ----------------------------------------------------------
  // RESET SESSION
  // Rewinds queue to first exercise without stopping camera.
  // ----------------------------------------------------------

  const resetSession = useCallback(() => {
    clearAdvanceTimeout();
    advancePendingRef.current = false;

    if (queueRef.current[0]) {
      queueIndexRef.current = 0;
      prescriptionRef.current = queueRef.current[0].prescription;
      setQueueIndex(0);
    }

    setSessionComplete(false);
  }, []);

  // ----------------------------------------------------------
  // END SESSION
  // Full stop — clears queue and resets all state.
  // ----------------------------------------------------------

  const endSession = useCallback(() => {
    clearAdvanceTimeout();

    queueRef.current = [];
    queueIndexRef.current = 0;
    prescriptionRef.current = null;
    advancePendingRef.current = false;

    setSessionStarted(false);
    setSessionComplete(false);
    setQueueIndex(0);
  }, []);

  // ----------------------------------------------------------
  // GETTERS (for use inside async loops)
  // ----------------------------------------------------------

  const getActivePrescription =
    useCallback((): ExercisePrescription | null => {
      return prescriptionRef.current;
    }, []);

  const getActiveQueue = useCallback((): QueueItem[] => {
    return queueRef.current;
  }, []);

  const getActiveQueueIndex = useCallback((): number => {
    return queueIndexRef.current;
  }, []);

  const isAdvancePending = useCallback((): boolean => {
    return advancePendingRef.current;
  }, []);

  // ----------------------------------------------------------
  // PROGRESS LABELS
  // ----------------------------------------------------------

  const overallProgressLabel = useMemo(() => {
    const queue = queueRef.current;
    if (queue.length === 0) return "No session selected";
    return `Exercise ${Math.min(queueIndex + 1, queue.length)} of ${queue.length}`;
  }, [queueIndex]);

  return {
    // State
    sessionStarted,
    sessionComplete,
    queueIndex,

    // Computed (re-read queue each render)
    currentQueueItem: queueRef.current[queueIndex] ?? null,
    currentPrescription:
      (queueRef.current[queueIndex] ?? null)?.prescription ?? null,

    // Labels
    overallProgressLabel,

    // Actions
    beginSession,
    advanceQueue,
    resetSession,
    endSession,

    // Async-safe getters
    getActivePrescription,
    getActiveQueue,
    getActiveQueueIndex,
    isAdvancePending,

    // Cleanup
    clearAdvanceTimeout
  };
}
