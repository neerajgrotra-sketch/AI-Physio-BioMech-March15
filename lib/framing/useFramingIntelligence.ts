// ============================================================
// lib/framing/useFramingIntelligence.ts
// ============================================================
// M16 redesign:
// - shouldPauseExercise removed — framing never blocks sessions
// - Pre-exercise voice guidance: fires once after 2s delay
//   (gives BlazePose time to warm up), max 2 attempts, 8s gap
// - Live frame/features read from refs so delayed check gets
//   current data, not stale data from call time
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

const INITIAL_CHECK_DELAY_MS      = 2000; // wait for BlazePose to warm up
const PRE_EXERCISE_RETRY_DELAY_MS = 8000; // gap between voice attempts
const PRE_EXERCISE_MAX_ATTEMPTS   = 2;    // max voice cues per exercise

// ============================================================
// PANEL STATE BUILDER
// ============================================================

function buildPanelState(
  message: string,
  severity: "ok" | "warning" | "critical",
  evaluating: boolean
): FramingPanelState {
  return {
    tone: severity === "ok" ? "good" : "warning", // never "critical" in UI
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

  // Live frame/features refs — updated every frame by evaluateFraming
  // so delayed timeouts always read current data, not stale call-time values
  const liveFrameRef        = useRef<PoseFrame | null>(null);
  const liveFeaturesRef     = useRef<MovementFeatures | null>(null);
  const livePrescriptionRef = useRef<ExercisePrescription | null>(null);

  // Pre-exercise voice guidance state
  const preExerciseActiveRef = useRef(false);
  const voiceAttemptCountRef = useRef(0);
  const voiceTimeoutRef      = useRef<number | null>(null);

  // Landmark confidence accumulator — reset per exercise
  const confidenceSamplesRef = useRef<number[]>([]);

  // ----------------------------------------------------------
  // SPEAK FRAMING CUE
  // Waits for any active coaching speech to finish first.
  // ----------------------------------------------------------

  const speakFramingCue = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate   = 0.92;
      utterance.pitch  = 1.0;
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
    };

    if (window.speechSynthesis.speaking) {
      const poll = () => {
        if (!preExerciseActiveRef.current) return;
        if (window.speechSynthesis.speaking) {
          window.setTimeout(poll, 300);
        } else {
          window.setTimeout(doSpeak, 400);
        }
      };
      window.setTimeout(poll, 300);
    } else {
      doSpeak();
    }
  }, []);

  // ----------------------------------------------------------
  // RUN FRAMING CHECK WITH LIVE DATA
  // Reads current frame/features from refs — not stale values.
  // ----------------------------------------------------------

  const runFramingCheck = useCallback((prescription: ExercisePrescription) => {
    const frame    = liveFrameRef.current;
    const features = liveFeaturesRef.current;
    const nowMs    = Date.now();

    if (!frame || !frame.personDetected || !features) {
      const msg = "Please step into the camera view.";
      setFramingPanelState(buildPanelState(msg, "warning", false));
      if (preExerciseActiveRef.current &&
          voiceAttemptCountRef.current < PRE_EXERCISE_MAX_ATTEMPTS) {
        voiceAttemptCountRef.current += 1;
        speakFramingCue(msg);
      }
      return;
    }

    const status = monitorRef.current.forcePreExerciseCheck(frame, features, prescription, nowMs);

    if (status.adequate) {
      setFramingPanelState(buildPanelState("Good position.", "ok", false));
      return;
    }

    const message = status.fallbackInstruction ?? "Adjust your position so I can see you clearly.";
    setFramingPanelState(buildPanelState(message, "warning", true));

    if (preExerciseActiveRef.current &&
        voiceAttemptCountRef.current < PRE_EXERCISE_MAX_ATTEMPTS) {
      voiceAttemptCountRef.current += 1;
      speakFramingCue(message);
    }

    // AI for a better instruction
    const confidenceReport = buildConfidenceReport(frame, features, prescription, nowMs);
    evaluatorRef.current.evaluate(
      prescription, status, confidenceReport, patientProfile,
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
  }, [patientProfile, speakFramingCue]);

  // ----------------------------------------------------------
  // RESET
  // ----------------------------------------------------------

  const reset = useCallback((message = "Position yourself in view.") => {
    monitorRef.current.reset();
    evaluatorRef.current.cancel();
    preExerciseActiveRef.current = false;
    voiceAttemptCountRef.current = 0;
    confidenceSamplesRef.current = [];
    livePrescriptionRef.current  = null;
    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
    setFramingPanelState(buildPanelState(message, "warning", false));
  }, []);

  // ----------------------------------------------------------
  // CANCEL PENDING EVALUATION
  // Called when patient starts moving — closes voice window.
  // ----------------------------------------------------------

  const cancelPendingEval = useCallback(() => {
    evaluatorRef.current.cancel();
    preExerciseActiveRef.current = false;
    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
  }, []);

  // ----------------------------------------------------------
  // SAMPLE LANDMARK CONFIDENCE
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
  // ----------------------------------------------------------

  const getLandmarkConfidencePct = useCallback((): number | null => {
    const samples = confidenceSamplesRef.current;
    if (samples.length === 0) return null;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return Math.round(avg * 100);
  }, []);

  // ----------------------------------------------------------
  // EVALUATE FRAMING
  // Called every frame (ready phase only).
  // Updates live refs so delayed checks read current data.
  // ----------------------------------------------------------

  const evaluateFraming = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => {
    // Keep live refs current
    liveFrameRef.current    = frame;
    liveFeaturesRef.current = features;

    sampleLandmarkConfidence(frame, prescription);

    const status = monitorRef.current.evaluate(frame, features, prescription, nowMs);
    if (!status) return;

    if (status.adequate) {
      setFramingPanelState(buildPanelState("Good position.", "ok", false));
      return;
    }

    const message = status.fallbackInstruction ?? "Adjust your position.";
    setFramingPanelState(buildPanelState(message, "warning", status.triggerAiEvaluation));

    // Mid-session: AI update only, never voice
    if (status.triggerAiEvaluation) {
      const confidenceReport = buildConfidenceReport(frame, features, prescription, nowMs);
      evaluatorRef.current.evaluate(
        prescription, status, confidenceReport, patientProfile,
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
  // Waits 2s for BlazePose to warm up, then evaluates using
  // live frame data from refs. Schedules a second check 8s later.
  // ----------------------------------------------------------

  const forcePreExerciseCheck = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => {
    // Reset for new exercise
    confidenceSamplesRef.current = [];
    livePrescriptionRef.current  = prescription;
    monitorRef.current.reset();

    // Seed live refs with current values
    liveFrameRef.current    = frame;
    liveFeaturesRef.current = features;

    // Open pre-exercise window
    preExerciseActiveRef.current = true;
    voiceAttemptCountRef.current = 0;

    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
    }

    // Show neutral pill while waiting
    setFramingPanelState(buildPanelState("Checking your position…", "warning", true));

    // First check after 2s — BlazePose should have a person by then
    voiceTimeoutRef.current = window.setTimeout(() => {
      voiceTimeoutRef.current = null;
      if (!preExerciseActiveRef.current) return;

      runFramingCheck(prescription);

      // Second check after another 8s if patient still hasn't moved
      voiceTimeoutRef.current = window.setTimeout(() => {
        voiceTimeoutRef.current = null;
        if (!preExerciseActiveRef.current) return;
        runFramingCheck(prescription);
      }, PRE_EXERCISE_RETRY_DELAY_MS);

    }, INITIAL_CHECK_DELAY_MS);

  }, [runFramingCheck]);

  return {
    framingPanelState,
    shouldPauseExercise: false,
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
