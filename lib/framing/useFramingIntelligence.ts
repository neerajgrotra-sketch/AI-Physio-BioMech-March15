// ============================================================
// lib/framing/useFramingIntelligence.ts
// ============================================================
// M16 redesign:
// - shouldPauseExercise removed — framing never blocks sessions
// - Pre-exercise voice guidance: fires once after 2s delay,
//   max 2 attempts, 8s gap
// - Live frame/features read from refs (not stale call-time values)
// - Mid-session: visual pill only, no voice, no blocking
// - Tracks landmark_confidence_pct per exercise for physio dashboard
// - Debug logging via console for tracing framing behaviour
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

const INITIAL_CHECK_DELAY_MS      = 2000;
const PRE_EXERCISE_RETRY_DELAY_MS = 8000;
const PRE_EXERCISE_MAX_ATTEMPTS   = 2;

// ============================================================
// DEBUG LOGGER
// ============================================================

function framingLog(msg: string, detail?: string) {
  const time = new Date().toLocaleTimeString("en-CA", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 2
  });
  console.log(`[FRAMING ${time}] ${msg}${detail ? " | " + detail : ""}`);
}

// ============================================================
// PANEL STATE BUILDER
// ============================================================

function buildPanelState(
  message: string,
  severity: "ok" | "warning" | "critical",
  evaluating: boolean
): FramingPanelState {
  return {
    tone: severity === "ok" ? "good" : "warning",
    message,
    evaluating,
    exercisePaused: false,
    severity
  };
}

// ============================================================
// HOOK
// ============================================================

type DebugLogger = (level: string, category: string, message: string, detail?: string) => void;

export function useFramingIntelligence(patientProfile: PatientProfile, debugLogger?: DebugLogger) {
  const monitorRef   = useRef(new FramingMonitor(2000));
  const evaluatorRef = useRef(new FramingEvaluator());

  // Routes to console via framingLog AND to SessionRunner debug panel
  const debugLoggerRef = useRef<DebugLogger | undefined>(debugLogger);
  debugLoggerRef.current = debugLogger; // keep current without re-renders
  const debugLog = (msg: string, detail?: string) => {
    framingLog(msg, detail);
    if (debugLoggerRef.current) debugLoggerRef.current("info", "FRAMING", msg, detail);
  };

  const [framingPanelState, setFramingPanelState] = useState<FramingPanelState>({
    tone: "warning",
    message: "Camera is off.",
    evaluating: false,
    exercisePaused: false,
    severity: "ok"
  });

  // Live refs — updated every frame so delayed checks read current data
  const liveFrameRef        = useRef<PoseFrame | null>(null);
  const liveFeaturesRef     = useRef<MovementFeatures | null>(null);
  const livePrescriptionRef = useRef<ExercisePrescription | null>(null);

  // Pre-exercise voice state
  const preExerciseActiveRef = useRef(false);
  const voiceAttemptCountRef = useRef(0);
  const voiceTimeoutRef      = useRef<number | null>(null);

  // Confidence accumulator
  const confidenceSamplesRef = useRef<number[]>([]);

  // ----------------------------------------------------------
  // SPEAK FRAMING CUE
  // Speaks immediately — does NOT wait for coaching speech.
  // Framing cue is a one-time positional instruction that
  // should fire even if the intro is still playing.
  // We cancel any current speech, speak framing cue, then
  // coaching brain will resume on next trigger naturally.
  // ----------------------------------------------------------

  // Speak a framing cue immediately (cancels current speech)
  const speakFramingCue = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92; utterance.pitch = 1.0; utterance.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Neural") || v.name.includes("Premium") || v.name.includes("Samantha") || v.name.includes("Karen") || v.name.includes("Daniel")));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    }, 100);
  }, []);

  // Speak a framing cue AFTER any current speech finishes.
  // Used for pre-exercise framing cues so they don't interrupt
  // the coaching intro but still fire once intro is done.
  // Respects preExerciseActiveRef — aborts if patient starts moving.
  const speakAfterCurrentSpeech = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    debugLog("speakAfterCurrentSpeech queued", `speaking=${window.speechSynthesis.speaking}`);

    const doSpeak = () => {
      if (!preExerciseActiveRef.current) {
        debugLog("speakAfterCurrentSpeech ABORTED — patient started moving");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92; utterance.pitch = 1.0; utterance.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Neural") || v.name.includes("Premium") || v.name.includes("Samantha") || v.name.includes("Karen") || v.name.includes("Daniel")));
      if (preferred) utterance.voice = preferred;
      debugLog("speakAfterCurrentSpeech FIRING", `text="${text}"`);
      if (debugLoggerRef.current) {
        debugLoggerRef.current("FRAMING_VOICE", "FRAMING_VOICE", `[FRAMING VOICE] "${text}"`, "pre-exercise framing guidance");
      }
      window.speechSynthesis.speak(utterance);
    };

    const poll = () => {
      if (!preExerciseActiveRef.current) return; // patient moved, abort
      if (window.speechSynthesis.speaking) {
        window.setTimeout(poll, 300);
      } else {
        window.setTimeout(doSpeak, 200); // small gap after speech ends
      }
    };

    if (window.speechSynthesis.speaking) {
      window.setTimeout(poll, 300);
    } else {
      window.setTimeout(doSpeak, 200);
    }
  }, []);

  // ----------------------------------------------------------
  // RUN FRAMING CHECK WITH LIVE DATA
  // ----------------------------------------------------------

  const runFramingCheck = useCallback((prescription: ExercisePrescription) => {
    const frame    = liveFrameRef.current;
    const features = liveFeaturesRef.current;
    const nowMs    = Date.now();

    debugLog("runFramingCheck", `preExerciseActive=${preExerciseActiveRef.current} attempts=${voiceAttemptCountRef.current} personDetected=${frame?.personDetected ?? false}`);

    if (!preExerciseActiveRef.current) {
      debugLog("runFramingCheck SKIPPED — pre-exercise window closed (patient already moving)");
      return;
    }

    if (!frame || !frame.personDetected || !features) {
      const msg = "Please step into the camera view.";
      debugLog("runFramingCheck — no person", msg);
      setFramingPanelState(buildPanelState(msg, "warning", false));
      if (voiceAttemptCountRef.current < PRE_EXERCISE_MAX_ATTEMPTS) {
        voiceAttemptCountRef.current += 1;
        debugLog(`voice attempt ${voiceAttemptCountRef.current}/${PRE_EXERCISE_MAX_ATTEMPTS}`, msg);
        // Wait for any current speech (coaching intro) to finish before speaking
        speakAfterCurrentSpeech(msg);
      }
      return;
    }

    const status = monitorRef.current.forcePreExerciseCheck(frame, features, prescription, nowMs);
    debugLog("runFramingCheck status", `adequate=${status.adequate} severity=${status.severity} fallback="${status.fallbackInstruction}"`);

    if (status.adequate) {
      debugLog("runFramingCheck — adequate, no voice needed");
      setFramingPanelState(buildPanelState("Good position.", "ok", false));
      return;
    }

    const message = status.fallbackInstruction ?? "Adjust your position so I can see you clearly.";
    setFramingPanelState(buildPanelState(message, "warning", true));

    if (voiceAttemptCountRef.current < PRE_EXERCISE_MAX_ATTEMPTS) {
      voiceAttemptCountRef.current += 1;
      debugLog(`voice attempt ${voiceAttemptCountRef.current}/${PRE_EXERCISE_MAX_ATTEMPTS}`, message);
      // Wait for coaching intro to finish, then speak framing cue
      speakAfterCurrentSpeech(message);
    } else {
      debugLog("runFramingCheck — max attempts reached, no voice");
    }

    // AI for better instruction
    const confidenceReport = buildConfidenceReport(frame, features, prescription, nowMs);
    evaluatorRef.current.evaluate(
      prescription, status, confidenceReport, patientProfile,
      (result) => {
        if (!result.isStillRelevant) return;
        debugLog("AI framing result", `instruction="${result.patientInstruction}"`);
        setFramingPanelState(
          buildPanelState(result.patientInstruction ?? "Good position.", result.severity, false)
        );
      },
      (fallback) => {
        setFramingPanelState(buildPanelState(fallback, status.severity, false));
      }
    );
  }, [patientProfile, speakAfterCurrentSpeech]);

  // ----------------------------------------------------------
  // RESET
  // ----------------------------------------------------------

  const reset = useCallback((message = "Position yourself in view.") => {
    debugLog("reset", message);
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
  // Called when patient starts moving (READY → LIFTING).
  // ----------------------------------------------------------

  const cancelPendingEval = useCallback(() => {
    debugLog("cancelPendingEval — closing pre-exercise voice window");
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
  // Called every frame (ready phase only). Updates live refs.
  // ----------------------------------------------------------

  const evaluateFraming = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => {
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
  // Waits 2s for BlazePose to warm up, then checks with live data.
  // ----------------------------------------------------------

  const forcePreExerciseCheck = useCallback((
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => {
    debugLog("forcePreExerciseCheck called", `ex=${prescription.id} personDetected=${frame?.personDetected ?? false}`);

    confidenceSamplesRef.current = [];
    livePrescriptionRef.current  = prescription;
    monitorRef.current.reset();

    liveFrameRef.current    = frame;
    liveFeaturesRef.current = features;

    // Open the pre-exercise voice window IMMEDIATELY.
    // This must happen before onExerciseStarted fires so that
    // cancelPendingEval (triggered by first READY→LIFTING) correctly
    // closes a window that was actually open.
    preExerciseActiveRef.current = true;
    voiceAttemptCountRef.current = 0;

    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
    }

    setFramingPanelState(buildPanelState("Checking your position…", "warning", true));

    // First framing check fires after INITIAL_CHECK_DELAY_MS (2s).
    // By this time liveFrameRef will have real BlazePose data.
    // speakAfterCurrentSpeech inside runFramingCheck ensures the
    // voice cue waits for coaching intro to finish before speaking.
    debugLog(`pre-exercise window OPEN — first voice check in ${INITIAL_CHECK_DELAY_MS}ms`);

    voiceTimeoutRef.current = window.setTimeout(() => {
      voiceTimeoutRef.current = null;
      debugLog("first framing check firing");
      runFramingCheck(prescription);

      // Schedule retry after 8s if still in pre-exercise window
      voiceTimeoutRef.current = window.setTimeout(() => {
        voiceTimeoutRef.current = null;
        debugLog("second framing check firing");
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
