// ============================================================
// lib/framing/useFramingIntelligence.ts
// ============================================================
// M16 redesign:
// - shouldPauseExercise removed — framing never blocks sessions
// - Pre-exercise voice guidance: fires once, max 2 attempts,
//   8s between attempts, silent after exercise starts
// - Mid-session: visual pill only, no voice, no blocking
// - Tracks landmark_confidence_pct per exercise for physio dashboard
// ============================================================

import { useRef, useState, useCallback } from "react";

import { FramingMonitor } from "@/lib/framing/framingMonitor";
import { FramingEvaluator } from "@/lib/framing/framingEvaluator";
import type { PatientProfile } from "@/lib/patient/patientTypes";
import type { FramingPanelState } from "@/lib/framing/framingTypes";
import type { PoseFrame } from "@/lib/types/pose";
import type { MovementFeatures } from "@/lib/types/movement";
import type { ExercisePrescription } from "@/lib/types/exercise";

// ============================================================
// CONSTANTS
// ============================================================

const PRE_EXERCISE_VOICE_INTERVAL_MS = 8000; // gap between voice attempts
const PRE_EXERCISE_MAX_ATTEMPTS = 2;          // max voice cues before giving up

// ============================================================
// PANEL STATE BUILDER
// ============================================================

function buildPanelState(
  message: string,
  severity: "ok" | "warning" | "critical",
  evaluating: boolean
): FramingPanelState {
  return {
    tone: severity === "ok" ? "good" : "warning", // never "critical" in UI — always amber at worst
    message,
    evaluating,
    exercisePaused: false, // always false — framing never pauses sessions
    severity
  };
}

// ============================================================
// HOOK
// ============================================================

export function useFramingIntelligence(patientProfile: PatientProfile) {
  const monitorRef   = useRef(new FramingMonitor(2000));
  const evaluatorRef = useRef(new FramingEvaluator());

  // UI state
  const [framingPanelState, setFramingPanelState] = useState<FramingPanelState>({
    tone: "warning",
    message: "Camera is off.",
    evaluating: false,
    exercisePaused: false,
    severity: "ok"
  });

  // Pre-exercise voice guidance state
  const preExerciseActiveRef    = useRef(false);  // true between forceCheck and first rep
  const voiceAttemptCountRef    = useRef(0);
  const lastVoiceAtMsRef        = useRef(0);
  const voiceTimeoutRef         = useRef<number | null>(null);

  // Landmark confidence accumulator — reset per exercise
  // Stores per-frame average confidence of critical landmarks
  const confidenceSamplesRef    = useRef<number[]>([]);
  const currentPrescriptionRef  = useRef<ExercisePrescription | null>(null);

  // ----------------------------------------------------------
  // SPEAK FRAMING CUE
  // Uses browser SpeechSynthesis — same engine as coaching brain
  // ----------------------------------------------------------

  const speakFramingCue = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // Don't interrupt active coaching speech
    if (window.speechSynthesis.speaking) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.lang.startsWith("en") && (
        v.name.includes("Natural") || v.name.includes("Neural") ||
        v.name.includes("Premium") || v.name.includes("Samantha") ||
        v.name.includes("Karen")   || v.name.includes("Daniel")
      )
    );
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  }, []);

  // ----------------------------------------------------------
  // SCHEDULE PRE-EXERCISE VOICE RETRY
  // After 8s, if still pre-exercise and still bad framing,
  // fire a second cue. Max 2 total.
  // ----------------------------------------------------------

  const scheduleVoiceRetry = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription
  ) => {
    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
    }
    voiceTimeoutRef.current = window.setTimeout(() => {
      voiceTimeoutRef.current = null;
      if (!preExerciseActiveRef.current) return; // session started, skip
      if (voiceAttemptCountRef.current >= PRE_EXERCISE_MAX_ATTEMPTS) return;

      // Re-evaluate framing right now
      const status = monitorRef.current.evaluate(frame, features, prescription, Date.now(), true);
      if (!status || status.adequate) return; // framing is fine now, no need

      const cue = status.fallbackInstruction ?? "Adjust your position so I can see you clearly.";
      voiceAttemptCountRef.current += 1;
      lastVoiceAtMsRef.current = Date.now();
      speakFramingCue(cue);
    }, PRE_EXERCISE_VOICE_INTERVAL_MS);
  }, [speakFramingCue]);

  // ----------------------------------------------------------
  // RESET
  // Call when session starts, exercise changes, or session ends
  // ----------------------------------------------------------

  const reset = useCallback((message = "Position yourself in view.") => {
    monitorRef.current.reset();
    evaluatorRef.current.cancel();
    preExerciseActiveRef.current = false;
    voiceAttemptCountRef.current = 0;
    lastVoiceAtMsRef.current = 0;
    confidenceSamplesRef.current = [];
    currentPrescriptionRef.current = null;
    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
    setFramingPanelState(buildPanelState(message, "warning", false));
  }, []);

  // ----------------------------------------------------------
  // CANCEL PENDING EVALUATION
  // Call when phase transitions out of ready (→ lifting).
  // Also marks pre-exercise phase as ended — no more voice.
  // ----------------------------------------------------------

  const cancelPendingEval = useCallback(() => {
    evaluatorRef.current.cancel();
    // Patient started moving — pre-exercise guidance window is closed
    preExerciseActiveRef.current = false;
    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
  }, []);

  // ----------------------------------------------------------
  // COMPUTE LANDMARK CONFIDENCE
  // Average confidence of critical landmarks for the current prescription.
  // Called every frame during active phases to accumulate samples.
  // ----------------------------------------------------------

  const sampleLandmarkConfidence = useCallback((
    frame: PoseFrame | null,
    prescription: ExercisePrescription
  ) => {
    if (!frame || !frame.personDetected) return;
    const allLandmarks = [
      ...prescription.framing.landmarks.critical,
      ...prescription.framing.landmarks.supporting,
    ];
    const scores = allLandmarks.map(name => {
      const lm = (frame as any)?.landmarks?.[name];
      return typeof lm?.score === "number" ? lm.score : (lm ? 1 : 0);
    }).filter(s => s > 0);

    if (scores.length === 0) return;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    confidenceSamplesRef.current.push(avg);
  }, []);

  // ----------------------------------------------------------
  // GET LANDMARK CONFIDENCE PCT
  // Returns average confidence across all samples for this exercise (0–100).
  // Call at exercise end before resetting.
  // ----------------------------------------------------------

  const getLandmarkConfidencePct = useCallback((): number | null => {
    const samples = confidenceSamplesRef.current;
    if (samples.length === 0) return null;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return Math.round(avg * 100);
  }, []);

  // ----------------------------------------------------------
  // EVALUATE FRAMING
  // Called every frame from the inference loop.
  // Throttled internally to every 2 seconds.
  // Only updates UI — never blocks or pauses anything.
  // ----------------------------------------------------------

  const evaluateFraming = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => {
    // Always accumulate confidence samples regardless of phase
    sampleLandmarkConfidence(frame, prescription);

    const status = monitorRef.current.evaluate(frame, features, prescription, nowMs);
    if (!status) return; // throttled — no update this frame

    if (status.adequate) {
      setFramingPanelState(buildPanelState("Good position.", "ok", false));
      return;
    }

    const message = status.fallbackInstruction ?? "Adjust your position.";
    setFramingPanelState(buildPanelState(message, "warning", status.triggerAiEvaluation));

    // Trigger AI evaluation for better instruction (no voice fired here — mid-session is silent)
    if (status.triggerAiEvaluation) {
      const confidenceReport = buildConfidenceReport(frame, features, prescription, nowMs);
      evaluatorRef.current.evaluate(
        prescription,
        status,
        confidenceReport,
        patientProfile,
        (result) => {
          if (!result.isStillRelevant) return;
          setFramingPanelState(
            buildPanelState(result.patientInstruction ?? "Good position.", result.severity, false)
          );
        },
        (fallback) => {
          setFramingPanelState(buildPanelState(fallback, status.severity, false));
        }
      );
    }
  }, [patientProfile, sampleLandmarkConfidence]);

  // ----------------------------------------------------------
  // FORCE PRE-EXERCISE CHECK
  // Called before each exercise starts.
  // This is the ONLY moment voice framing guidance can fire.
  // ----------------------------------------------------------

  const forcePreExerciseCheck = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => {
    // Reset confidence tracking for new exercise
    confidenceSamplesRef.current = [];
    currentPrescriptionRef.current = prescription;

    monitorRef.current.reset();
    const status = monitorRef.current.forcePreExerciseCheck(frame, features, prescription, nowMs);

    // Open pre-exercise voice window
    preExerciseActiveRef.current = true;
    voiceAttemptCountRef.current = 0;
    lastVoiceAtMsRef.current = 0;

    if (status.adequate) {
      setFramingPanelState(buildPanelState("Good position.", "ok", false));
      // No voice needed — framing is fine
      return;
    }

    const message = status.fallbackInstruction ?? "Adjust your position so I can see you clearly.";
    setFramingPanelState(buildPanelState(message, "warning", true));

    // Fire first voice cue immediately (attempt 1 of max 2)
    voiceAttemptCountRef.current = 1;
    lastVoiceAtMsRef.current = nowMs;
    speakFramingCue(message);

    // Schedule retry after 8s (attempt 2 of max 2)
    scheduleVoiceRetry(frame, features, prescription);

    // Also trigger AI for a better instruction
    const confidenceReport = buildConfidenceReport(frame, features, prescription, nowMs);
    evaluatorRef.current.evaluate(
      prescription,
      status,
      confidenceReport,
      patientProfile,
      (result) => {
        if (!result.isStillRelevant) return;
        setFramingPanelState(
          buildPanelState(result.patientInstruction ?? "Good position.", result.severity, false)
        );
      },
      (fallback) => {
        setFramingPanelState(buildPanelState(fallback, status.severity, false));
      }
    );
  }, [patientProfile, speakFramingCue, scheduleVoiceRetry]);

  return {
    framingPanelState,
    shouldPauseExercise: false, // always false — kept for interface compatibility
    evaluateFraming,
    forcePreExerciseCheck,
    reset,
    cancelPendingEval,
    getLandmarkConfidencePct,
    sampleLandmarkConfidence,
  };
}

// ============================================================
// HELPERS
// ============================================================

function buildConfidenceReport(
  frame: PoseFrame | null,
  features: MovementFeatures,
  prescription: ExercisePrescription,
  nowMs: number
) {
  return {
    landmarks: Object.fromEntries(
      [
        ...prescription.framing.landmarks.critical,
        ...prescription.framing.landmarks.supporting,
        ...prescription.framing.landmarks.reference,
      ].map((name) => {
        const lm = (frame as any)?.landmarks?.[name];
        const score = typeof lm?.score === "number" ? lm.score : 0;
        return [name, score];
      })
    ),
    personDetected: Boolean((frame as any)?.personDetected),
    estimatedCoverage: "upper_body" as const,
    estimatedPosture: features.isSeated
      ? ("seated" as const)
      : features.isStanding
      ? ("standing" as const)
      : ("unknown" as const),
    isCentered: true,
    capturedAtMs: nowMs,
  };
}
