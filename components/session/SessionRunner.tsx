"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import CameraViewport, {
  type CameraViewportHandle
} from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import CoachingPanel from "@/components/coaching/CoachingPanel";
import { useSessionLibrary } from "@/components/providers/SessionLibraryProvider";

import { ACTIVE_EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement } from "@/lib/interpreter/movementInterpreter";
import { useVoiceCoaching } from "@/lib/coaching/useVoiceCoaching";
import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";
import {
  buildRehabState,
  type RehabEvent
} from "@/lib/engine/rehabStateBuilder";
import { buildCoachingOrchestration } from "@/lib/engine/coachingOrchestrator";
import { generateCoaching } from "@/lib/ai/llmCoach";

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { CoachingDecision } from "@/lib/types/coaching";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { TherapySession } from "@/lib/sessions/sessionTypes";

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

  if (minMinutes === maxMinutes) {
    return `About ${minMinutes} min`;
  }

  return `About ${minMinutes}-${maxMinutes} min`;
}

function inferSessionGoal(exerciseIds: string[]): string {
  const set = new Set(exerciseIds);

  if (
    set.has("right-arm-raise") ||
    set.has("left-arm-raise") ||
    set.has("both-arm-raise")
  ) {
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

type PreviewExerciseItem = {
  id: string;
  displayName: string;
  prescription: ExercisePrescription;
  seconds: number;
};

type SessionPreviewData = {
  session: TherapySession;
  items: PreviewExerciseItem[];
  durationSeconds: number;
  totalReps: number;
};

function buildSessionPreviewData(
  session: TherapySession,
  prescriptions: ExercisePrescription[]
): SessionPreviewData {
  const items = session.exercises
    .map((item) => {
      const prescription =
        prescriptions.find((p) => p.id === item.prescriptionId) ?? null;

      if (!prescription) return null;

      return {
        id: prescription.id,
        displayName: item.displayName,
        prescription,
        seconds: estimateExerciseSeconds(prescription)
      };
    })
    .filter(
      (
        item
      ): item is PreviewExerciseItem => item !== null
    );

  return {
    session,
    items,
    durationSeconds: items.reduce((sum, item) => sum + item.seconds, 0),
    totalReps: items.reduce((sum, item) => sum + item.prescription.repTarget, 0)
  };
}

function getFramingText(prescription: ExercisePrescription | null): string {
  if (!prescription) {
    return "Stand or sit centered in frame with your upper body clearly visible.";
  }

  if (prescription.id === "sit-to-stand") {
    return "Frame your full body and chair clearly, with hips and knees visible.";
  }

  return "Stand or sit centered in frame with your upper body and both arms visible.";
}

export default function SessionRunner() {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;

  const cameraRef = useRef<CameraViewportHandle | null>(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const exerciseAdvanceTimeoutRef = useRef<number | null>(null);

  const trackingActiveRef = useRef(false);
  const advancePendingRef = useRef(false);
  const repStateRef = useRef<RuntimeRepState>(createInitialRepState());
  const featureHistoryRef = useRef(new FeatureHistory(5));
  const stickyCoachingUntilRef = useRef<number>(0);
  const stickyCoachingRef = useRef<CoachingDecision | null>(null);
  const prescriptionRef = useRef<ExercisePrescription | null>(null);

  const activeQueueRef = useRef<PreviewExerciseItem[]>([]);
  const queueIndexRef = useRef(0);

  const aiRequestInFlightRef = useRef(false);
  const aiEventTokenRef = useRef(0);
  const lastSpokenAtRef = useRef(0);

  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [aiCoachingEnabled, setAiCoachingEnabled] = useState(true);

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [holdRemainingMs, setHoldRemainingMs] = useState<number | null>(null);
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(null);
  const [coaching, setCoaching] = useState<CoachingDecision>(createIdleCoaching());
  const [engineStatus, setEngineStatus] = useState<
    "idle" | "loading" | "running" | "error"
  >("idle");
  const [engineError, setEngineError] = useState("");

  useVoiceCoaching(coaching.message, {
    enabled: voiceEnabled,
    cooldownMs: 1800,
    rate: 0.92
  });

  useEffect(() => {
    if (selectedSessionIds.length === 0 && sessions[0]) {
      setSelectedSessionIds([sessions[0].id]);
    }
  }, [sessions, selectedSessionIds.length]);

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
  const currentQueueItem = combinedQueue[queueIndexRef.current] ?? null;
  const currentPrescription = currentQueueItem?.prescription ?? null;

  useEffect(() => {
    prescriptionRef.current = currentPrescription;
  }, [currentPrescription]);

  useEffect(() => {
    if (previewIndex > Math.max(sessionPreviews.length - 1, 0)) {
      setPreviewIndex(0);
    }
  }, [previewIndex, sessionPreviews.length]);

  function clearAdvanceTimeout() {
    if (exerciseAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(exerciseAdvanceTimeoutRef.current);
      exerciseAdvanceTimeoutRef.current = null;
    }
  }

  function setStickyCoaching(decision: CoachingDecision, durationMs = 2200) {
    stickyCoachingRef.current = decision;
    stickyCoachingUntilRef.current = Date.now() + durationMs;
    setCoaching(decision);
  }

  function resetExerciseState() {
    repStateRef.current = createInitialRepState();
    featureHistoryRef.current.clear();
    stickyCoachingRef.current = null;
    stickyCoachingUntilRef.current = 0;
    advancePendingRef.current = false;
    aiRequestInFlightRef.current = false;
    aiEventTokenRef.current = 0;
    lastSpokenAtRef.current = 0;

    setRepCount(0);
    setPhase("ready");
    setHoldRemainingMs(null);
    setActiveMetricValue(null);
  }

  function stopTracking() {
    trackingActiveRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    clearAdvanceTimeout();
    videoRef.current = null;

    setEngineStatus("idle");
    setEngineError("");
    setFrame(null);
    setFeatures(createEmptyFeatures());
    setSessionStarted(false);
    setSessionComplete(false);
    queueIndexRef.current = 0;
    activeQueueRef.current = [];
    prescriptionRef.current = null;
    resetExerciseState();
    setCoaching(createIdleCoaching());
  }

  async function beginTracking(video: HTMLVideoElement) {
    try {
      setEngineStatus("loading");
      setEngineError("");
      videoRef.current = video;
      trackingActiveRef.current = true;

      resetExerciseState();

      if (!detectorRef.current) {
        detectorRef.current = await createPoseDetector();
      }

      setEngineStatus("running");

      const loop = async () => {
        if (!trackingActiveRef.current) return;

        const liveVideo = videoRef.current;
        const detector = detectorRef.current;
        const activePrescription = prescriptionRef.current;

        if (!liveVideo || !detector || !activePrescription) return;

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

          const now = Date.now();
          const orchestration = buildCoachingOrchestration({
            event,
            output,
            prescription: activePrescription,
            previousPhase,
            currentPhase: output.repState.phase,
            nowMs: now,
            lastSpokenAtMs: lastSpokenAtRef.current,
            aiEnabled: aiCoachingEnabled
          });

          if (orchestration.shouldUpdatePanel) {
            if (orchestration.stickyMs > 0) {
              setStickyCoaching(orchestration.decision, orchestration.stickyMs);
            } else if (
              stickyCoachingRef.current &&
              now < stickyCoachingUntilRef.current
            ) {
              setCoaching(stickyCoachingRef.current);
            } else {
              stickyCoachingRef.current = null;
              stickyCoachingUntilRef.current = 0;
              setCoaching(orchestration.decision);
            }
          }

          const shouldAskAi =
            orchestration.trigger === "ai" &&
            orchestration.shouldSpeak &&
            !aiRequestInFlightRef.current &&
            (event === "start" ||
              event === "rep_complete" ||
              event === "rep_failed" ||
              event === "exercise_complete");

          if (shouldAskAi) {
            const rehabState = buildRehabState(
              smoothedFeatures,
              output.repState,
              activePrescription,
              event
            );

            const eventToken = Date.now();
            aiEventTokenRef.current = eventToken;
            aiRequestInFlightRef.current = true;

            generateCoaching(rehabState)
              .then((message) => {
                if (!message) return;
                if (aiEventTokenRef.current !== eventToken) return;

                const aiDecision: CoachingDecision = {
                  code: orchestration.decision.code,
                  priority: orchestration.decision.priority,
                  message
                };

                setStickyCoaching(
                  aiDecision,
                  event === "rep_failed" ? 4000 : 2400
                );
                lastSpokenAtRef.current = Date.now();
              })
              .catch((error) => {
                console.error("LLM coaching failed:", error);
              })
              .finally(() => {
                if (aiEventTokenRef.current === eventToken) {
                  aiRequestInFlightRef.current = false;
                }
              });
          } else if (orchestration.shouldSpeak) {
            lastSpokenAtRef.current = now;
          }

          if (output.isComplete && !advancePendingRef.current) {
            advancePendingRef.current = true;

            const nextIndex = queueIndexRef.current + 1;
            const nextExercise = activeQueueRef.current[nextIndex] ?? null;

            if (nextExercise) {
              setStickyCoaching(
                {
                  code: "exercise_complete",
                  priority: "encourage",
                  message: `Exercise complete. Next: ${nextExercise.displayName}.`
                },
                2200
              );

              clearAdvanceTimeout();
              exerciseAdvanceTimeoutRef.current = window.setTimeout(() => {
                queueIndexRef.current = nextIndex;
                prescriptionRef.current = nextExercise.prescription;
                advancePendingRef.current = false;
                resetExerciseState();
              }, 2200);
            } else {
              setSessionComplete(true);
              setStickyCoaching(
                {
                  code: "exercise_complete",
                  priority: "encourage",
                  message: "Session complete. Well done."
                },
                2600
              );
            }
          }
        } catch (error) {
          if (!trackingActiveRef.current) return;

          const message = error instanceof Error ? error.message : String(error);

          if (
            message.toLowerCase().includes("aborted") ||
            message.toLowerCase().includes("abort")
          ) {
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

    activeQueueRef.current = combinedQueue;
    queueIndexRef.current = 0;
    prescriptionRef.current = combinedQueue[0].prescription;

    setSessionStarted(true);
    setSessionComplete(false);
    resetExerciseState();

    setStickyCoaching(
      {
        code: "start_exercise",
        priority: "info",
        message: "Session started. Please step into view."
      },
      1800
    );

    try {
      await cameraRef.current?.startCamera();
    } catch {}
  }

  function endSession() {
    cameraRef.current?.stopCamera();
  }

  function resetSession() {
    clearAdvanceTimeout();
    queueIndexRef.current = 0;
    if (activeQueueRef.current[0]) {
      prescriptionRef.current = activeQueueRef.current[0].prescription;
    }
    setSessionComplete(false);
    resetExerciseState();
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

  const canBegin = combinedQueue.length > 0 && engineStatus !== "running" && engineStatus !== "loading";
  const currentExerciseLabel = currentQueueItem?.displayName ?? "No active exercise";
  const overallProgressLabel =
    combinedQueue.length > 0
      ? `Exercise ${Math.min(queueIndexRef.current + 1, combinedQueue.length)} of ${combinedQueue.length}`
      : "No session selected";

  const holdSeconds =
    holdRemainingMs !== null ? Math.max(1, Math.ceil(holdRemainingMs / 1000)) : null;

  return (
    <div style={{ marginTop: 12 }}>
      <h1
        style={{
          marginTop: 0,
          marginBottom: 18,
          fontSize: 28,
          lineHeight: 1.2
        }}
      >
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
                opacity: engineStatus === "running" || engineStatus === "error" ? 1 : 0.5
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
              {selectorCollapsed ? "Expand" : "Collapse"}
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
          gridTemplateColumns: "1.55fr 1fr",
          gap: 20,
          alignItems: "start"
        }}
      >
        <section
          style={{
            background: "#1a2040",
            padding: 20,
            borderRadius: 14,
            minHeight: 400,
            border: "1px solid rgba(255,255,255,0.08)"
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

          <div style={{ position: "relative", width: "100%", maxWidth: 720 }}>
            <CameraViewport
              ref={cameraRef}
              onVideoReady={beginTracking}
              onCameraStop={stopTracking}
              showStartButton={false}
            />

            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                maxWidth: 640,
                height: 420,
                pointerEvents: "none"
              }}
            >
              <PoseCanvasOverlay frame={frame} width={640} height={420} />
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "#aab6d3",
              lineHeight: 1.5
            }}
          >
            {getFramingText(currentPrescription)}
          </div>

          {engineError && (
            <p style={{ color: "#ff8f8f", marginBottom: 0, marginTop: 12 }}>
              {engineError}
            </p>
          )}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <CoachingPanel
            title="Live Coaching"
            message={coaching.message}
            phase={phase}
            repCount={repCount}
            repTarget={currentPrescription?.repTarget ?? 0}
            exerciseName={currentExerciseLabel}
            progressLabel={overallProgressLabel}
            holdSeconds={holdSeconds}
            minHeight={340}
          />

          <section
            style={{
              background: "#1a2040",
              padding: 20,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)"
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#7cc6ff",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: 0.6
              }}
            >
              Session Status
            </div>

            <div style={{ display: "grid", gap: 10, fontSize: 15 }}>
              <div>
                Current exercise: <strong>{currentExerciseLabel}</strong>
              </div>
              <div>
                Progress: <strong>{overallProgressLabel}</strong>
              </div>
              <div>
                Camera status: <strong>{engineStatus}</strong>
              </div>
              <div>
                Voice coaching: <strong>{voiceEnabled ? "On" : "Off"}</strong>
              </div>
              <div>
                AI coaching variation: <strong>{aiCoachingEnabled ? "On" : "Off"}</strong>
              </div>
              {activeMetricValue !== null && (
                <div>
                  Live metric: <strong>{activeMetricValue}</strong>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
