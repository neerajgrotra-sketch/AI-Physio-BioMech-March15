// ============================================================
// lib/framing/useFramingIntelligence.ts
// ============================================================
// M19 changes:
// - Exposes prerequisiteResult from evaluatePrerequisites()
//   so SessionRunner and useInferenceLoop can gate on it
// - Fixes hardcoded estimatedCoverage: "upper_body" bug in
//   buildConfidenceReport — now derived from the live frame
// - Pre-exercise voice guidance and AI evaluator unchanged
// ============================================================

import { useRef, useState, useCallback } from "react";

import { FramingMonitor, evaluatePrerequisites } from "@/lib/framing/framingMonitor";
import type { PrerequisiteResult } from "@/lib/framing/framingMonitor";
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
// COVERAGE ESTIMATOR
// ============================================================
// Derives estimatedCoverage from the live frame the same way
// FramingMonitor does. Replaces the previous hardcoded
// "upper_body" that was being sent to the AI evaluator.

function estimateCoverageFromFrame(
  frame: PoseFrame | null
): "none" | "head_only" | "upper_body" | "torso_and_hips" | "full_body" {
  if (!frame || !(frame as any).personDetected) return "none";

  const lm = (frame as any)?.landmarks ?? {};
  const conf = (name: string): number => {
    const p = lm[name];
    if (!p || typeof p.x !== "number") return 0;
    return typeof p.score === "number" ? p.score : 1;
  };
  const v = (name: string) => conf(name) > 0.2;

  const hasHead      = v("nose");
  const hasShoulders = v("left_shoulder") && v("right_shoulder");
  const hasHips      = v("left_hip") && v("right_hip");
  const hasKnees     = v("left_knee") || v("right_knee");
  const hasAnkles    = v("left_ankle") || v("right_ankle");

  if (hasHead && hasShoulders && hasHips && hasKnees && hasAnkles) return "full_body";
  if (hasHead && hasShoulders && hasHips && hasKnees) return "torso_and_hips";
  if (hasHead && hasShoulders && hasHips) return "torso_and_hips";
  if (hasHead && hasShoulders) return "upper_body";
  if (hasHead) return "head_only";
  return "none";
}

// ============================================================
// HOOK
// ============================================================

type DebugLogger = (level: string, category: string, message: string, detail?: string) => void;

export function useFramingIntelligence(patientProfile: PatientProfile, debugLogger?: DebugLogger) {
  const monitorRef   = useRef(new FramingMonitor(2000));
  const evaluatorRef = useRef(new FramingEvaluator());

  const debugLoggerRef = useRef<DebugLogger | undefined>(debugLogger);
  debugLoggerRef.current = debugLogger;
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

  // Exposed to useInferenceLoop — updated every frame in ready phase
  const [prerequisiteResult, setPrerequisiteResult] = useState<PrerequisiteResult>({
    allMet: true,
    failures: []
  });
  const prerequisiteResultRef = useRef<PrerequisiteResult>({ allMet: true, failures: [] });

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
  const prereqLastLogMsRef   = useRef<number>(0);

  // ----------------------------------------------------------
  // SPEAK FRAMING CUE
  // ----------------------------------------------------------

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
      if (!preExerciseActiveRef.current) return;
      if (window.speechSynthesis.speaking) {
        window.setTimeout(poll, 300);
      } else {
        window.setTimeout(doSpeak, 200);
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

    // Use the prereq failure message if prerequisites aren't met —
    // it's more specific and actionable than the monitor's fallback.
    // e.g. "Please step back so I can see your full body" rather than "Please sit down"
    const prereqNow = prerequisiteResultRef.current;
    const message = (!prereqNow.allMet && prereqNow.failures.length > 0)
      ? prereqNow.failures[0].patientMessage
      : (status.fallbackInstruction ?? "Adjust your position so I can see you clearly.");
    setFramingPanelState(buildPanelState(message, "warning", true));

    if (voiceAttemptCountRef.current < PRE_EXERCISE_MAX_ATTEMPTS) {
      voiceAttemptCountRef.current += 1;
      debugLog(`voice attempt ${voiceAttemptCountRef.current}/${PRE_EXERCISE_MAX_ATTEMPTS}`, message);
      speakAfterCurrentSpeech(message);
    } else {
      debugLog("runFramingCheck — max attempts reached, no voice");
    }

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
    const initial: PrerequisiteResult = { allMet: true, failures: [] };
    prerequisiteResultRef.current = initial;
    setPrerequisiteResult(initial);
    setFramingPanelState(buildPanelState(message, "warning", false));
  }, []);

  // ----------------------------------------------------------
  // CANCEL PENDING EVALUATION
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
  // EVALUATE FRAMING (called every ready-phase frame)
  // Updates live refs AND runs prerequisite check every frame.
  // Prerequisite result is written to both ref and state so
  // useInferenceLoop reads the ref (zero cost, no re-render)
  // while SessionRunner reads the state for UI.
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

    // Run prerequisite check every frame — pure function, cheap
    const prereqResult = evaluatePrerequisites(prescription, frame, features);
    prerequisiteResultRef.current = prereqResult;
    setPrerequisiteResult(prereqResult);

    // When prerequisites fail, show the specific instruction in the framing panel
    // and skip the generic monitor evaluation. Throttle the debug log to 2s.
    if (!prereqResult.allMet && prereqResult.failures.length > 0) {
      const f = prereqResult.failures[0];
      console.log(`[PREREQ FAIL] id=${f.id} | ${f.clinicalNote}`);
      const nowForLog = nowMs;
      if (nowForLog - prereqLastLogMsRef.current >= 2000) {
        prereqLastLogMsRef.current = nowForLog;
        if (debugLoggerRef.current) {
          debugLoggerRef.current("warning", "PREREQ", `PREREQ FAIL: ${f.id}`, f.clinicalNote);
        }
      }
      setFramingPanelState(buildPanelState(f.patientMessage, "warning", false));
      return;
    }

    // Throttled monitor evaluation for framing panel
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

    preExerciseActiveRef.current = true;
    voiceAttemptCountRef.current = 0;

    if (voiceTimeoutRef.current !== null) {
      window.clearTimeout(voiceTimeoutRef.current);
    }

    setFramingPanelState(buildPanelState("Checking your position…", "warning", true));

    debugLog(`pre-exercise window OPEN — first voice check in ${INITIAL_CHECK_DELAY_MS}ms`);

    voiceTimeoutRef.current = window.setTimeout(() => {
      voiceTimeoutRef.current = null;
      debugLog("first framing check firing");
      runFramingCheck(prescription);

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
    // New: prerequisite gate — read by useInferenceLoop via ref,
    // by SessionRunner via state
    prerequisiteResult,
    prerequisiteResultRef,
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
    // Fixed: derive coverage from live frame, not hardcoded "upper_body"
    estimatedCoverage: estimateCoverageFromFrame(frame),
    estimatedPosture: features.isSeated
      ? ("seated" as const)
      : features.isStanding
      ? ("standing" as const)
      : ("unknown" as const),
    isCentered: (() => {
      const nose = (frame as any)?.landmarks?.["nose"];
      return !!(nose && typeof nose.x === "number" && nose.x >= 0.18 && nose.x <= 0.82);
    })(),
    capturedAtMs: nowMs,
  };
}
