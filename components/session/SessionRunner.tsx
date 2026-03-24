"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import CameraViewport, {
  type CameraViewportHandle
} from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import CoachingPanel from "@/components/coaching/CoachingPanel";
import DebugPanel from "@/components/debug/DebugPanel";
import AiDebugPanel from "@/components/debug/AiDebugPanel";
import OpenAiConnectivityPanel from "@/components/status/OpenAiConnectivityPanel";
import { useSessionLibrary } from "@/components/providers/SessionLibraryProvider";

import { ACTIVE_EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement } from "@/lib/interpreter/movementInterpreter";
import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";
import { evaluateReadiness } from "@/lib/engine/readinessEngine";
import { buildRehabState, type RehabEvent } from "@/lib/engine/rehabStateBuilder";
import { PhysioCoachingEngine } from "@/lib/coaching/PhysioCoachingEngine";

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { CoachingDecision } from "@/lib/types/coaching";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { TherapySession } from "@/lib/sessions/sessionTypes";
import type { VoiceIntent } from "@/lib/coaching/types";

type PreviewExerciseItem = {
  id: string;
  displayName: string;
  prescription: ExercisePrescription;
  seconds: number;
  sessionName: string;
};

type SessionPreviewData = {
  session: TherapySession;
  items: PreviewExerciseItem[];
  durationSeconds: number;
  totalReps: number;
};

type FramingBannerState = {
  tone: "good" | "warning";
  message: string;
};

const INTRO_LOCK_MS = 2600;

function createEmptyFeatures(): MovementFeatures {
  return {
    posture: "unknown",
    rightArmElevationDeg: null,
    leftArmElevationDeg: null,
    bilateralArmElevationDeg: null,
    rightElbowAngleDeg: null,
    leftElbowAngleDeg: null,
    torsoLeanDeg: null,
    shoulderTiltDeg: null,
    rightWristAboveShoulder: false,
    leftWristAboveShoulder: false,
    rightWristToShoulderDy: null,
    leftWristToShoulderDy: null,
    hipCenterY: null,
    hipHeightNormalized: null,
    kneeAngleLeft: null,
    kneeAngleRight: null,
    hipVelocityY: null,
    isStanding: false,
    isSeated: false
  };
}

function createIdleCoaching(): CoachingDecision {
  return {
    code: "idle",
    priority: "info",
    message: "Select one or more sessions, then press Begin Session."
  };
}

function formatPhase(phase: string): string {
  if (phase === "lifting") return "Lift";
  if (phase === "holding") return "Hold";
  if (phase === "lowering") return "Lower";
  if (phase === "ready") return "Ready";
  if (phase === "complete") return "Complete";
  return "Tracking";
}

function estimateExerciseSeconds(prescription: ExercisePrescription): number {
  const holdSec = prescription.hold.required
    ? prescription.hold.durationMs / 1000
    : 0;
  const repSeconds = Math.max(6, 4 + holdSec + 2);
  return prescription.repTarget * repSeconds;
}

function formatDurationRange(totalSeconds: number): string {
  const minMinutes = Math.max(1, Math.floor(totalSeconds / 60));
  const maxMinutes = Math.max(minMinutes, Math.ceil(totalSeconds / 60) + 1);
  return minMinutes === maxMinutes ? `About ${minMinutes} min` : `About ${minMinutes}-${maxMinutes} min`;
}

function inferSessionGoal(exerciseIds: string[]): string {
  const set = new Set(exerciseIds);

  if (set.has("right-arm-raise") || set.has("left-arm-raise") || set.has("both-arm-raise")) {
    if (set.has("sit-to-stand")) {
      return "Improve upper-body mobility, posture control, and functional movement.";
    }
    return "Improve shoulder mobility, arm control, and upright posture.";
  }

  if (set.has("sit-to-stand")) {
    return "Improve lower-body strength, transfer ability, and balance.";
  }

  return "Support safe, guided rehabilitation movement.";
}

function buildSessionPreviewData(
  session: TherapySession,
  prescriptions: ExercisePrescription[]
): SessionPreviewData {
  const items = session.exercises
    .map((item) => {
      const prescription = prescriptions.find((p) => p.id === item.prescriptionId) ?? null;
      if (!prescription) return null;

      return {
        id: prescription.id,
        displayName: item.displayName,
        prescription,
        seconds: estimateExerciseSeconds(prescription),
        sessionName: session.name
      };
    })
    .filter((item): item is PreviewExerciseItem => item !== null);

  return {
    session,
    items,
    durationSeconds: items.reduce((sum, item) => sum + item.seconds, 0),
    totalReps: items.reduce((sum, item) => sum + item.prescription.repTarget, 0)
  };
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function isCalibrationExercise(prescription: ExercisePrescription | null): boolean {
  if (!prescription) return false;
  return (
    prescription.id === "right-arm-raise" ||
    prescription.id === "left-arm-raise" ||
    prescription.id === "both-arm-raise"
  );
}

function hasPassedArmRaiseCalibration(features: MovementFeatures): boolean {
  const rightRaised =
    features.rightWristAboveShoulder ||
    (features.rightArmElevationDeg !== null && features.rightArmElevationDeg >= 55);

  const leftRaised =
    features.leftWristAboveShoulder ||
    (features.leftArmElevationDeg !== null && features.leftArmElevationDeg >= 55);

  return rightRaised && leftRaised;
}

function getStartMessage(prescription: ExercisePrescription | null): string {
  if (!prescription) {
    return "Stand facing the camera and get ready to begin.";
  }

  switch (prescription.id) {
    case "right-arm-raise":
      return "Right arm raises. Lift your right arm to shoulder height, hold, then lower slowly.";
    case "left-arm-raise":
      return "Left arm raises. Lift your left arm to shoulder height, hold, then lower slowly.";
    case "both-arm-raise":
      return "Both arm raises. Lift both arms evenly to shoulder height, hold, then lower slowly.";
    case "sit-to-stand":
      return "Sit to stand. Stand up fully, then lower back down slowly.";
    default:
      return `${prescription.name}. Move slowly and with control.`;
  }
}

function buildPreCalibrationBanner(
  readinessMessage: string,
  personDetected: boolean
): FramingBannerState {
  if (!personDetected) {
    return {
      tone: "warning",
      message: "Step into view so I can see you properly."
    };
  }

  if (
    readinessMessage &&
    readinessMessage !== "Framing looks good." &&
    readinessMessage !== "You're well positioned."
  ) {
    return {
      tone: "warning",
      message: readinessMessage
    };
  }

  return {
    tone: "warning",
    message: "Lift both arms once so I can check your framing."
  };
}

function buildPassiveFramingBanner(
  readinessReady: boolean,
  readinessMessage: string,
  personDetected: boolean
): FramingBannerState {
  if (!personDetected) {
    return {
      tone: "warning",
      message: "Step into view so I can see you properly."
    };
  }

  if (!readinessReady) {
    return {
      tone: "warning",
      message: readinessMessage
    };
  }

  return {
    tone: "good",
    message: "Framing looks good."
  };
}

function mapVoiceIntentToDecision(intent: VoiceIntent): CoachingDecision {
  switch (intent.kind) {
    case "encouragement":
      return { code: "good_rep", priority: "encourage", message: intent.text };
    case "recovery":
      return { code: "rep_failed_hold", priority: "correct", message: intent.text };
    case "hold_cue": {
      const lower = intent.text.toLowerCase();
      if (lower.includes("bring it down")) {
        return { code: "lower_slowly", priority: "info", message: intent.text };
      }
      if (lower.includes("hold")) {
        return { code: "hold_position", priority: "info", message: intent.text };
      }
      return { code: "keep_holding", priority: "info", message: intent.text };
    }
    case "correction": {
      const lower = intent.text.toLowerCase();
      if (lower.includes("higher")) {
        return { code: "lift_higher", priority: "correct", message: intent.text };
      }
      return { code: "keep_balanced", priority: "correct", message: intent.text };
    }
    case "exercise_transition":
      return { code: "exercise_complete", priority: "encourage", message: intent.text };
    default:
      return { code: "start_exercise", priority: "info", message: intent.text };
  }
}

export default function SessionRunner() {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;

  const cameraRef = useRef<CameraViewportHandle | null>(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const advanceTimeoutRef = useRef<number | null>(null);
  const introTimeoutRef = useRef<number | null>(null);

  const trackingActiveRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const repStateRef = useRef<RuntimeRepState>(createInitialRepState());
  const featureHistoryRef = useRef(new FeatureHistory(5));
  const prescriptionRef = useRef<ExercisePrescription | null>(null);
  const activeQueueRef = useRef<PreviewExerciseItem[]>([]);
  const queueIndexRef = useRef(0);
  const advancePendingRef = useRef(false);

  const coachingEngineRef = useRef(new PhysioCoachingEngine());
  const introActiveRef = useRef(false);
  const introPendingRef = useRef(false);
  const introReleaseAtRef = useRef<number | null>(null);
  const calibrationCompleteRef = useRef(false);
  const speakingIntentIdRef = useRef<string | null>(null);

  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const [showDebug, setShowDebug] = useState(true);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [aiCoachingEnabled, setAiCoachingEnabled] = useState(false);
  const [realVoiceEnabled, setRealVoiceEnabled] = useState(false);

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [holdRemainingMs, setHoldRemainingMs] = useState<number | null>(null);
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(null);
  const [coaching, setCoaching] = useState<CoachingDecision>(createIdleCoaching());
  const [framingBanner, setFramingBanner] = useState<FramingBannerState>({
    tone: "warning",
    message: "Camera is off."
  });
  const [framingCalibrated, setFramingCalibrated] = useState(false);
  const [engineStatus, setEngineStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [engineError, setEngineError] = useState("");

  const [lastEvent, setLastEvent] = useState<RehabEvent>("idle");
  const [lastPrimaryIssue, setLastPrimaryIssue] = useState("idle");
  const [lastDetectedIssues, setLastDetectedIssues] = useState<string[]>([]);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  const [coachingDebug, setCoachingDebug] = useState<unknown>(null);

  const selectedSessions = useMemo(() => {
    return sessions.filter((session) => selectedSessionIds.includes(session.id));
  }, [sessions, selectedSessionIds]);

  const sessionPreviews = useMemo(() => {
    return selectedSessions.map((session) => buildSessionPreviewData(session, exercises));
  }, [selectedSessions, exercises]);

  const combinedQueue = useMemo(() => {
    return sessionPreviews.flatMap((preview) => preview.items);
  }, [sessionPreviews]);

  const combinedDurationSeconds = useMemo(() => {
    return sessionPreviews.reduce((sum, preview) => sum + preview.durationSeconds, 0);
  }, [sessionPreviews]);

  const combinedTotalReps = useMemo(() => {
    return sessionPreviews.reduce((sum, preview) => sum + preview.totalReps, 0);
  }, [sessionPreviews]);

  const combinedGoal = useMemo(() => {
    return inferSessionGoal(combinedQueue.map((item) => item.id));
  }, [combinedQueue]);

  const activePreview = sessionPreviews[previewIndex] ?? null;
  const currentQueueItem = activeQueueRef.current[queueIndexRef.current] ?? null;
  const currentPrescription = currentQueueItem?.prescription ?? null;

  useEffect(() => {
    if (selectedSessionIds.length === 0 && sessions[0]) {
      setSelectedSessionIds([sessions[0].id]);
    }
  }, [sessions, selectedSessionIds.length]);

  useEffect(() => {
    prescriptionRef.current = currentPrescription;
  }, [currentPrescription]);

  useEffect(() => {
    if (previewIndex > Math.max(sessionPreviews.length - 1, 0)) {
      setPreviewIndex(0);
    }
  }, [previewIndex, sessionPreviews.length]);

  function clearAdvanceTimeout() {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
  }

  function clearIntroTimeout() {
    if (introTimeoutRef.current !== null) {
      window.clearTimeout(introTimeoutRef.current);
      introTimeoutRef.current = null;
    }
  }

  function cancelBrowserSpeech() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }

  function speakIntent(intent: VoiceIntent) {
    if (!voiceEnabled) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    cancelBrowserSpeech();

    const utterance = new SpeechSynthesisUtterance(intent.text);
    utterance.rate = realVoiceEnabled ? 0.92 : 0.88;
    utterance.pitch = 1;
    utterance.volume = 1;

    speakingIntentIdRef.current = intent.id;
    coachingEngineRef.current.markSpeechStarted(intent.id, Date.now());

    utterance.onend = () => {
      coachingEngineRef.current.markSpeechCompleted(intent.id, Date.now());
      if (speakingIntentIdRef.current === intent.id) {
        speakingIntentIdRef.current = null;
      }
    };

    utterance.onerror = () => {
      coachingEngineRef.current.markSpeechCompleted(intent.id, Date.now());
      if (speakingIntentIdRef.current === intent.id) {
        speakingIntentIdRef.current = null;
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  function applyIntent(intent: VoiceIntent) {
    const decision = mapVoiceIntentToDecision(intent);
    setCoaching({
      ...decision,
      message: normalizeMessage(decision.message)
    });
    speakIntent(intent);
  }

  function setIntroActive(active: boolean, nowMs?: number) {
    introActiveRef.current = active;
    coachingEngineRef.current.setExerciseIntroActive(active, nowMs ?? Date.now());

    if (!active) {
      introReleaseAtRef.current = null;
      introPendingRef.current = false;
    }
  }

  function triggerExerciseIntro(prescription: ExercisePrescription | null, delayMs = 1200) {
    if (!prescription) return;

    clearIntroTimeout();
    introPendingRef.current = true;

    introTimeoutRef.current = window.setTimeout(() => {
      introPendingRef.current = false;
      setIntroActive(true, Date.now());

      const intent: VoiceIntent = {
        id: `exercise-intro-${prescription.id}-${Date.now()}`,
        kind: "exercise_intro",
        text: getStartMessage(prescription),
        priority: 4,
        speakDuringPhases: ["ready"],
        validWhile: () => true,
        expiresAfterMs: 6000,
        cancelIfPhaseChanges: true,
        createdAt: Date.now(),
        exerciseId: prescription.id,
        timing: {
          mandatorySilenceAfterMs: INTRO_LOCK_MS
        },
        interruption: {
          canInterruptCurrentSpeech: false,
          flushLowerPriorityQueue: false
        }
      };

      introReleaseAtRef.current = Date.now() + INTRO_LOCK_MS;
      applyIntent(intent);

      introTimeoutRef.current = window.setTimeout(() => {
        setIntroActive(false, Date.now());
      }, INTRO_LOCK_MS);
    }, delayMs);
  }

  function resetExerciseRuntime() {
    repStateRef.current = createInitialRepState();
    featureHistoryRef.current.clear();
    advancePendingRef.current = false;
    calibrationCompleteRef.current = false;
    setFramingCalibrated(false);

    setRepCount(0);
    setPhase("ready");
    setHoldRemainingMs(null);
    setActiveMetricValue(null);
    setLastEvent("idle");
    setLastPrimaryIssue("idle");
    setLastDetectedIssues([]);
    setLastFailureReason(null);

    introPendingRef.current = false;
    setIntroActive(false, Date.now());
  }

  function resetSessionRuntime() {
    coachingEngineRef.current.resetSession(`session-${Date.now()}`);
    clearAdvanceTimeout();
    clearIntroTimeout();
    cancelBrowserSpeech();
    speakingIntentIdRef.current = null;
    introPendingRef.current = false;
    setIntroActive(false, Date.now());
  }

  function stopTracking() {
    trackingActiveRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    clearAdvanceTimeout();
    clearIntroTimeout();
    cancelBrowserSpeech();

    videoRef.current = null;
    sessionStartedRef.current = false;
    activeQueueRef.current = [];
    queueIndexRef.current = 0;
    prescriptionRef.current = null;

    resetSessionRuntime();

    setEngineStatus("idle");
    setEngineError("");
    setFrame(null);
    setFeatures(createEmptyFeatures());
    setSessionStarted(false);
    setSessionComplete(false);
    setFramingBanner({
      tone: "warning",
      message: "Camera is off."
    });
    setCoaching(createIdleCoaching());
    setCoachingDebug(null);

    resetExerciseRuntime();
  }

  async function beginTracking(video: HTMLVideoElement) {
    try {
      setEngineStatus("loading");
      setEngineError("");
      videoRef.current = video;
      trackingActiveRef.current = true;

      resetExerciseRuntime();

      if (!detectorRef.current) {
        detectorRef.current = await createPoseDetector();
      }

      setEngineStatus("running");

      const loop = async () => {
        if (!trackingActiveRef.current) return;

        const liveVideo = videoRef.current;
        const detector = detectorRef.current;
        const activePrescription = prescriptionRef.current;

        if (!liveVideo || !detector || !activePrescription) {
          if (trackingActiveRef.current) {
            rafRef.current = window.requestAnimationFrame(loop);
          }
          return;
        }

        if (
          liveVideo.readyState < 2 ||
          liveVideo.videoWidth === 0 ||
          liveVideo.videoHeight === 0
        ) {
          rafRef.current = window.requestAnimationFrame(loop);
          return;
        }

        try {
          const poses = await detector.estimatePoses(liveVideo);
          if (!trackingActiveRef.current) return;

          const pose = poses[0] ?? null;
          const normalized = normalizePoseFrame(
            pose,
            liveVideo.videoWidth || 1,
            liveVideo.videoHeight || 1
          );

          setFrame(normalized);

          const rawFeatures = normalized.personDetected
            ? extractMovementFeatures(normalized)
            : createEmptyFeatures();

          if (normalized.personDetected) {
            featureHistoryRef.current.push(rawFeatures);
          } else {
            featureHistoryRef.current.clear();
          }

          const smoothedFeatures = normalized.personDetected
            ? smoothMovementFeatures(featureHistoryRef.current.getAll())
            : createEmptyFeatures();

          setFeatures(smoothedFeatures);

          const previousPhase = repStateRef.current.phase;

          const output = interpretMovement(
            repStateRef.current,
            smoothedFeatures,
            activePrescription,
            {
              timestampMs: Date.now(),
              personDetected: normalized.personDetected,
              balanceOk: true,
              activeMetricValue: null
            }
          );

          let event: RehabEvent = "idle";

          if (output.isComplete && previousPhase !== "complete") {
            event = "exercise_complete";
          } else if (output.repState.justCompletedRep) {
            event = "rep_complete";
          } else if (output.repState.justFailedRep) {
            event = "rep_failed";
          } else if (previousPhase === "ready" && output.repState.phase === "lifting") {
            event = "start";
          } else if (previousPhase !== output.repState.phase) {
            event = "phase_change";
          }

          repStateRef.current = output.repState;

          setRepCount(output.repState.repCount);
          setPhase(output.repState.phase);
          setHoldRemainingMs(output.holdRemainingMs);
          setActiveMetricValue(output.activeMetricValue);
          setLastEvent(event);
          setLastPrimaryIssue(output.primaryIssue);

          // Only release intro once the intro is actually on screen.
         if (
  introActiveRef.current &&
  !introPendingRef.current &&
  output.repState.phase !== "ready"
) {
  clearIntroTimeout();
  setIntroActive(false, Date.now());

  // Force the intro to give up control as soon as the user starts moving.
  coachingEngineRef.current.interruptSpeech(Date.now());
  coachingEngineRef.current.flushVoiceQueue();

  // Clear the visible intro immediately so live coaching can take over.
  setCoaching({
    code: "idle",
    priority: "info",
    message: ""
  });
}

          const rehabState = buildRehabState(
            smoothedFeatures,
            output.repState,
            activePrescription,
            event
          );

          setLastDetectedIssues(rehabState.detectedIssues);
          setLastFailureReason(rehabState.failureReason);

          const readiness = evaluateReadiness({
            frame: normalized,
            features: smoothedFeatures,
            prescription: activePrescription,
            averageBrightness: null
          });

          const calibrationRequired = isCalibrationExercise(activePrescription);

          if (
            calibrationRequired &&
            !calibrationCompleteRef.current &&
            normalized.personDetected &&
            readiness.checks.upperBodyVisible &&
            hasPassedArmRaiseCalibration(smoothedFeatures)
          ) {
            calibrationCompleteRef.current = true;
            setFramingCalibrated(true);

            const confirmIntent: VoiceIntent = {
              id: `framing-confirmed-${Date.now()}`,
              kind: "framing",
              text: "Framing confirmed. We can begin.",
              priority: 5,
              speakDuringPhases: ["ready"],
              validWhile: () => true,
              expiresAfterMs: 4000,
              cancelIfPhaseChanges: true,
              createdAt: Date.now(),
              exerciseId: activePrescription.id,
              timing: {
                mandatorySilenceAfterMs: 1800
              },
              interruption: {
                canInterruptCurrentSpeech: true,
                flushLowerPriorityQueue: true
              }
            };

            applyIntent(confirmIntent);
            triggerExerciseIntro(activePrescription, 900);
          }

          const calibrationActive = calibrationRequired && !calibrationCompleteRef.current;

          if (calibrationActive) {
            setFramingBanner(
              buildPreCalibrationBanner(readiness.message, normalized.personDetected)
            );

            coachingEngineRef.current.setCalibrationActive(true);

            if (
              normalizeMessage(coaching.message) !==
              normalizeMessage("Lift both arms once so I can check your framing.")
            ) {
              const framingIntent: VoiceIntent = {
                id: `framing-check-${activePrescription.id}-${Date.now()}`,
                kind: "framing",
                text: "Lift both arms once so I can check your framing.",
                priority: 5,
                speakDuringPhases: ["ready"],
                validWhile: () => true,
                expiresAfterMs: 7000,
                cancelIfPhaseChanges: true,
                createdAt: Date.now(),
                exerciseId: activePrescription.id,
                timing: {
                  mandatorySilenceAfterMs: 4500
                },
                interruption: {
                  canInterruptCurrentSpeech: true,
                  flushLowerPriorityQueue: true
                }
              };

              applyIntent(framingIntent);
            }

            if (trackingActiveRef.current) {
              rafRef.current = window.requestAnimationFrame(loop);
            }
            return;
          }

          coachingEngineRef.current.setCalibrationActive(false);

          setFramingBanner(
            buildPassiveFramingBanner(
              readiness.ready,
              readiness.message,
              normalized.personDetected
            )
          );

          if (!calibrationRequired && !introActiveRef.current && !introPendingRef.current) {
            triggerExerciseIntro(activePrescription, 0);
          }

          const holdRequiredMs = activePrescription.hold.durationMs;
          const holdElapsedMs =
            output.holdRemainingMs !== null
              ? Math.max(0, holdRequiredMs - output.holdRemainingMs)
              : null;

          const coachingTick = coachingEngineRef.current.tick({
            timestampMs: Date.now(),
            sessionId: "active-session",
            exerciseId: activePrescription.id,
            phase: output.repState.phase as any,
            repCount: output.repState.repCount,
            holdElapsedMs,
            holdRequiredMs,
            detectedIssues: rehabState.detectedIssues,
            primaryIssue: output.primaryIssue,
            armElevation:
              activePrescription.side === "right"
                ? smoothedFeatures.rightArmElevationDeg
                : activePrescription.side === "left"
                  ? smoothedFeatures.leftArmElevationDeg
                  : smoothedFeatures.bilateralArmElevationDeg,
            calibrationActive: false,
            exerciseIntroActive: introActiveRef.current || introPendingRef.current
          });

          setCoachingDebug({
            observations: coachingTick.observations,
            queue: coachingTick.queueSnapshot,
            behaviour: coachingTick.behaviourState,
            aiEnabled: aiCoachingEnabled
          });

          if (coachingTick.nextSpeakableIntent) {
            applyIntent(coachingTick.nextSpeakableIntent);
          }

          if (output.isComplete && !advancePendingRef.current) {
            advancePendingRef.current = true;

            const nextIndex = queueIndexRef.current + 1;
            const nextExercise = activeQueueRef.current[nextIndex] ?? null;

            if (nextExercise) {
              const transitionIntent: VoiceIntent = {
                id: `exercise-complete-${Date.now()}`,
                kind: "exercise_transition",
                text: `Exercise complete. Next: ${nextExercise.displayName}.`,
                priority: 5,
                speakDuringPhases: ["ready", "complete", "lowering"],
                validWhile: () => true,
                expiresAfterMs: 5000,
                cancelIfPhaseChanges: false,
                createdAt: Date.now(),
                exerciseId: activePrescription.id,
                timing: {
                  mandatorySilenceAfterMs: 2200
                },
                interruption: {
                  canInterruptCurrentSpeech: true,
                  flushLowerPriorityQueue: true
                }
              };

              applyIntent(transitionIntent);

              clearAdvanceTimeout();
              advanceTimeoutRef.current = window.setTimeout(() => {
                queueIndexRef.current = nextIndex;
                prescriptionRef.current = nextExercise.prescription;

                resetExerciseRuntime();
                coachingEngineRef.current.resetExercise(nextExercise.prescription.id);

                if (isCalibrationExercise(nextExercise.prescription)) {
                  const framingIntent: VoiceIntent = {
                    id: `framing-check-${nextExercise.prescription.id}-${Date.now()}`,
                    kind: "framing",
                    text: "Lift both arms once so I can check your framing.",
                    priority: 5,
                    speakDuringPhases: ["ready"],
                    validWhile: () => true,
                    expiresAfterMs: 7000,
                    cancelIfPhaseChanges: true,
                    createdAt: Date.now(),
                    exerciseId: nextExercise.prescription.id,
                    timing: {
                      mandatorySilenceAfterMs: 4500
                    },
                    interruption: {
                      canInterruptCurrentSpeech: true,
                      flushLowerPriorityQueue: true
                    }
                  };

                  applyIntent(framingIntent);
                } else {
                  calibrationCompleteRef.current = true;
                  setFramingCalibrated(true);
                  triggerExerciseIntro(nextExercise.prescription, 0);
                }
              }, 2200);
            } else {
              setSessionComplete(true);

              const doneIntent: VoiceIntent = {
                id: `session-complete-${Date.now()}`,
                kind: "exercise_transition",
                text: "Session complete. Well done.",
                priority: 5,
                speakDuringPhases: ["ready", "complete", "lowering"],
                validWhile: () => true,
                expiresAfterMs: 5000,
                cancelIfPhaseChanges: false,
                createdAt: Date.now(),
                exerciseId: activePrescription.id,
                timing: {
                  mandatorySilenceAfterMs: 2600
                },
                interruption: {
                  canInterruptCurrentSpeech: true,
                  flushLowerPriorityQueue: true
                }
              };

              applyIntent(doneIntent);
            }
          }
        } catch (error) {
          if (!trackingActiveRef.current) return;

          const message = error instanceof Error ? error.message : String(error);

          if (message.toLowerCase().includes("aborted") || message.toLowerCase().includes("abort")) {
            if (trackingActiveRef.current) {
              rafRef.current = window.requestAnimationFrame(loop);
            }
            return;
          }

          setEngineStatus("error");
          setEngineError(message || "Pose estimation failed.");
          return;
        }

        if (trackingActiveRef.current) {
          rafRef.current = window.requestAnimationFrame(loop);
        }
      };

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(loop);
    } catch (error) {
      trackingActiveRef.current = false;
      setEngineStatus("error");
      setEngineError(
        error instanceof Error ? error.message : "Could not initialize pose detector."
      );
    }
  }

  function toggleSessionSelection(sessionId: string) {
    if (sessionStarted || engineStatus === "loading" || engineStatus === "running") {
      return;
    }

    setSelectedSessionIds((current) => {
      if (current.includes(sessionId)) {
        const next = current.filter((id) => id !== sessionId);
        return next.length > 0 ? next : current;
      }
      return [...current, sessionId];
    });
  }

  async function beginCombinedSession() {
    if (combinedQueue.length === 0) return;

    const firstPrescription = combinedQueue[0].prescription;
    const needsCalibration = isCalibrationExercise(firstPrescription);

    activeQueueRef.current = combinedQueue;
    queueIndexRef.current = 0;
    prescriptionRef.current = firstPrescription;

    resetSessionRuntime();
    resetExerciseRuntime();

    setSessionStarted(true);
    sessionStartedRef.current = true;
    setSessionComplete(false);
    setSelectorCollapsed(true);
    setStatusCollapsed(false);
    setFramingBanner({
      tone: "warning",
      message: "Position yourself in view."
    });

    if (needsCalibration) {
      coachingEngineRef.current.setCalibrationActive(true);

      const framingIntent: VoiceIntent = {
        id: `framing-start-${Date.now()}`,
        kind: "framing",
        text: "Lift both arms once so I can check your framing.",
        priority: 5,
        speakDuringPhases: ["ready"],
        validWhile: () => true,
        expiresAfterMs: 7000,
        cancelIfPhaseChanges: true,
        createdAt: Date.now(),
        exerciseId: firstPrescription.id,
        timing: {
          mandatorySilenceAfterMs: 4500
        },
        interruption: {
          canInterruptCurrentSpeech: true,
          flushLowerPriorityQueue: true
        }
      };

      applyIntent(framingIntent);
    } else {
      calibrationCompleteRef.current = true;
      setFramingCalibrated(true);
      coachingEngineRef.current.setCalibrationActive(false);
      triggerExerciseIntro(firstPrescription, 0);
    }

    try {
      await cameraRef.current?.startCamera();
    } catch {
      stopTracking();
    }
  }

  function endSession() {
    cameraRef.current?.stopCamera();
  }

  function resetSession() {
    clearAdvanceTimeout();
    clearIntroTimeout();
    queueIndexRef.current = 0;

    if (activeQueueRef.current[0]) {
      prescriptionRef.current = activeQueueRef.current[0].prescription;
    }

    setSessionComplete(false);
    resetSessionRuntime();
    resetExerciseRuntime();

    setFramingBanner({
      tone: "warning",
      message: sessionStarted ? "Position yourself in view." : "Camera is off."
    });

    setCoaching(
      sessionStarted
        ? {
            code: "start_exercise",
            priority: "info",
            message: "Session reset. Press Begin Session to start again."
          }
        : createIdleCoaching()
    );
  }

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, []);

  const canBegin =
    combinedQueue.length > 0 &&
    engineStatus !== "running" &&
    engineStatus !== "loading";

  const currentExerciseLabel = currentQueueItem?.displayName ?? "No active exercise";
  const currentQueueIndex = queueIndexRef.current;
  const overallProgressLabel =
    activeQueueRef.current.length > 0
      ? `Exercise ${Math.min(currentQueueIndex + 1, activeQueueRef.current.length)} of ${activeQueueRef.current.length}`
      : "No session selected";

  const holdSeconds =
    holdRemainingMs !== null ? Math.max(1, Math.ceil(holdRemainingMs / 1000)) : null;

  return (
    <div style={{ marginTop: 12 }}>
      <h1 style={{ marginTop: 0, marginBottom: 18, fontSize: 28, lineHeight: 1.2 }}>
        AI Physio BioMech Session Runner
      </h1>

      <section
        style={{
          background: "#1a2040",
          padding: 18,
          borderRadius: 14,
          marginBottom: 20,
          border: "1px solid rgba(255,255,255,0.08)"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: selectorCollapsed ? 0 : 16,
            flexWrap: "wrap"
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Session Selector</h2>
            {!selectorCollapsed && (
              <div style={{ color: "#aab6d3", marginTop: 6, fontSize: 14 }}>
                Select one or more sessions and review the combined plan before starting.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={beginCombinedSession}
              disabled={!canBegin}
              style={{
                background: "#9be7b0",
                color: "#08111f",
                fontWeight: 700,
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: canBegin ? "pointer" : "not-allowed",
                opacity: canBegin ? 1 : 0.5
              }}
            >
              Begin Session
            </button>

            <button
              onClick={endSession}
              disabled={engineStatus !== "running" && engineStatus !== "error"}
              style={{
                background: "#7cc6ff",
                color: "#08111f",
                fontWeight: 700,
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor:
                  engineStatus === "running" || engineStatus === "error"
                    ? "pointer"
                    : "not-allowed",
                opacity:
                  engineStatus === "running" || engineStatus === "error" ? 1 : 0.5
              }}
            >
              End Session
            </button>

            <button
              onClick={resetSession}
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer"
              }}
            >
              Reset Session
            </button>

            <button
              onClick={() => setSelectorCollapsed((v) => !v)}
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer"
              }}
            >
              {selectorCollapsed ? "Expand Selector" : "Collapse Selector"}
            </button>

            <button
              onClick={() => setShowDebug((v) => !v)}
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer"
              }}
            >
              {showDebug ? "Hide Debug" : "Show Debug"}
            </button>
          </div>
        </div>

        {!selectorCollapsed && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "340px 1fr",
              gap: 18,
              alignItems: "start"
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "#7cc6ff",
                  marginBottom: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.6
                }}
              >
                Available Sessions
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {sessions.map((session) => {
                  const checked = selectedSessionIds.includes(session.id);

                  return (
                    <label
                      key={session.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: checked ? "rgba(124,198,255,0.12)" : "#121933",
                        border: checked
                          ? "1px solid rgba(124,198,255,0.35)"
                          : "1px solid rgba(255,255,255,0.08)",
                        cursor: "pointer"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSessionSelection(session.id)}
                        style={{ marginTop: 2 }}
                      />
                      <div>
                        <div style={{ fontWeight: 700 }}>{session.name}</div>
                        <div style={{ fontSize: 13, color: "#aab6d3", marginTop: 4 }}>
                          {session.exercises.length} exercise
                          {session.exercises.length === 1 ? "" : "s"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                background: "#121933",
                borderRadius: 12,
                padding: 16,
                minHeight: 200
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 14,
                  flexWrap: "wrap"
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "#7cc6ff",
                    textTransform: "uppercase",
                    letterSpacing: 0.6
                  }}
                >
                  Session Preview
                </div>

                {sessionPreviews.length > 1 && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() =>
                        setPreviewIndex((current) =>
                          current === 0 ? sessionPreviews.length - 1 : current - 1
                        )
                      }
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        border: "none",
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer"
                      }}
                    >
                      Previous
                    </button>

                    <button
                      onClick={() =>
                        setPreviewIndex((current) =>
                          current === sessionPreviews.length - 1 ? 0 : current + 1
                        )
                      }
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        border: "none",
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer"
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>

              {sessionPreviews.length > 0 ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.1fr 1fr",
                      gap: 16,
                      marginBottom: 18
                    }}
                  >
                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: 10 }}>Combined Summary</h3>
                      <div style={{ color: "#d8e2ff", marginBottom: 10, lineHeight: 1.5 }}>
                        {combinedGoal}
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "rgba(124,198,255,0.12)",
                            color: "#7cc6ff",
                            fontSize: 12
                          }}
                        >
                          {formatDurationRange(combinedDurationSeconds)}
                        </span>

                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            color: "white",
                            fontSize: 12
                          }}
                        >
                          {selectedSessions.length} session
                          {selectedSessions.length === 1 ? "" : "s"}
                        </span>

                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            color: "white",
                            fontSize: 12
                          }}
                        >
                          {combinedQueue.length} exercise
                          {combinedQueue.length === 1 ? "" : "s"}
                        </span>

                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            color: "white",
                            fontSize: 12
                          }}
                        >
                          {combinedTotalReps} total reps
                        </span>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: 10 }}>
                        {activePreview?.session.name ?? "Session"}
                      </h3>

                      <div style={{ color: "#aab6d3", marginBottom: 10, lineHeight: 1.5 }}>
                        {activePreview
                          ? inferSessionGoal(activePreview.items.map((item) => item.id))
                          : "Select a session to preview it."}
                      </div>

                      {activePreview && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span
                            style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              background: "rgba(124,198,255,0.12)",
                              color: "#7cc6ff",
                              fontSize: 12
                            }}
                          >
                            {formatDurationRange(activePreview.durationSeconds)}
                          </span>

                          <span
                            style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              background: "rgba(255,255,255,0.08)",
                              color: "white",
                              fontSize: 12
                            }}
                          >
                            {activePreview.totalReps} reps
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {(activePreview?.items ?? []).map((item, index) => (
                      <div
                        key={`${item.id}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.04)"
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{item.displayName}</div>
                          <div style={{ fontSize: 13, color: "#aab6d3", marginTop: 2 }}>
                            {item.prescription.repTarget} reps
                            {item.prescription.hold.required
                              ? ` • ${item.prescription.hold.durationMs / 1000}s hold`
                              : ""}
                            {item.prescription.tempo?.label
                              ? ` • ${item.prescription.tempo.label}`
                              : ""}
                          </div>
                        </div>

                        <div
                          style={{
                            alignSelf: "center",
                            fontSize: 12,
                            color: "#aab6d3",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {formatDurationRange(item.seconds)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ color: "#aab6d3" }}>
                  Select one or more sessions to preview the combined plan.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          alignItems: "stretch"
        }}
      >
        <section
          style={{
            background: "#1a2040",
            padding: 20,
            borderRadius: 14,
            minHeight: 540,
            border: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              marginBottom: 14,
              flexWrap: "wrap"
            }}
          >
            <h2 style={{ margin: 0 }}>Therapy View</h2>

            <div
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: "rgba(124,198,255,0.12)",
                color: "#7cc6ff",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              {sessionComplete ? "Complete" : formatPhase(phase)}
            </div>
          </div>

          <div style={{ width: "100%", maxWidth: 720 }}>
            <div
              style={{
                marginBottom: 10,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background:
                  framingBanner.tone === "good"
                    ? "rgba(100,220,150,0.15)"
                    : "rgba(255,180,80,0.15)",
                color: framingBanner.tone === "good" ? "#9be7b0" : "#ffcc80",
                border:
                  framingBanner.tone === "good"
                    ? "1px solid rgba(100,220,150,0.4)"
                    : "1px solid rgba(255,180,80,0.4)"
              }}
            >
              {framingBanner.message}
            </div>

            <div style={{ position: "relative", width: "100%" }}>
              <CameraViewport
                ref={cameraRef}
                onVideoReady={beginTracking}
                onCameraStop={stopTracking}
                showStartButton={false}
              />

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none"
                }}
              >
                <PoseCanvasOverlay frame={frame} />
              </div>
            </div>
          </div>

          {engineError && (
            <p style={{ color: "#ff8f8f", marginBottom: 0, marginTop: 12 }}>
              {engineError}
            </p>
          )}
        </section>

        <CoachingPanel
          title="Live Coaching"
          message={coaching.message}
          secondaryMessage={null}
          phase={phase}
          repCount={repCount}
          repTarget={currentPrescription?.repTarget ?? 0}
          exerciseName={currentExerciseLabel}
          progressLabel={overallProgressLabel}
          holdSeconds={holdSeconds}
          minHeight={540}
        />
      </div>

      <section
        style={{
          background: "#1a2040",
          padding: 16,
          borderRadius: 14,
          marginTop: 20,
          border: "1px solid rgba(255,255,255,0.08)"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: statusCollapsed ? 0 : 12
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Session Status</h3>
            {!statusCollapsed && (
              <div style={{ color: "#aab6d3", marginTop: 4, fontSize: 13 }}>
                Current session progress and coaching settings.
              </div>
            )}
          </div>

          <button
            onClick={() => setStatusCollapsed((v) => !v)}
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "white",
              padding: "8px 12px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer"
            }}
          >
            {statusCollapsed ? "Expand Status" : "Collapse Status"}
          </button>
        </div>

        {!statusCollapsed && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 14,
                fontSize: 14
              }}
            >
              <div>
                Current exercise:
                <div style={{ fontWeight: 700, marginTop: 4 }}>{currentExerciseLabel}</div>
              </div>

              <div>
                Progress:
                <div style={{ fontWeight: 700, marginTop: 4 }}>{overallProgressLabel}</div>
              </div>

              <div>
                Camera status:
                <div style={{ fontWeight: 700, marginTop: 4 }}>{engineStatus}</div>
              </div>

              <div>
                Voice coaching:
                <div style={{ fontWeight: 700, marginTop: 4 }}>
                  {voiceEnabled ? "On" : "Off"}
                </div>
              </div>

              <div>
                Real voice:
                <div style={{ fontWeight: 700, marginTop: 4 }}>
                  {realVoiceEnabled ? "On" : "Off"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14 }}>
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 14,
                  color: "white"
                }}
              >
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                />
                Voice coaching
              </label>

              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 14,
                  color: "white"
                }}
              >
                <input
                  type="checkbox"
                  checked={aiCoachingEnabled}
                  onChange={(e) => setAiCoachingEnabled(e.target.checked)}
                />
                AI coaching variation
              </label>

              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 14,
                  color: "white"
                }}
              >
                <input
                  type="checkbox"
                  checked={realVoiceEnabled}
                  onChange={(e) => setRealVoiceEnabled(e.target.checked)}
                />
                Real voice
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <OpenAiConnectivityPanel />
            </div>
          </>
        )}
      </section>

      {showDebug && (
        <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
          <DebugPanel features={features} />

          <AiDebugPanel
            runtime={{
              phase,
              repCount,
              repTarget: currentPrescription?.repTarget ?? 0,
              holdSeconds,
              activeMetricValue,
              engineStatus,
              currentExercise: currentExerciseLabel,
              overallProgress: overallProgressLabel,
              lastEvent,
              primaryIssue: lastPrimaryIssue,
              detectedIssues: lastDetectedIssues,
              failureReason: lastFailureReason,
              aiRequestInFlight: false
            }}
            features={features}
            aiDebug={coachingDebug}
          />
        </div>
      )}
    </div>
  );
}
