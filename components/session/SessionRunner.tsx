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

type RunnerMode = "session" | "exercise";

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

function createIdleCoaching(mode: RunnerMode): CoachingDecision {
  return {
    code: "idle",
    priority: "info",
    message:
      mode === "session"
        ? "Choose a session, then press Begin Session."
        : "Choose an exercise, then press Begin Session."
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

function inferExerciseGoal(prescription: ExercisePrescription): string {
  if (prescription.id === "right-arm-raise") {
    return "Improve right shoulder mobility and controlled movement.";
  }

  if (prescription.id === "left-arm-raise") {
    return "Improve left shoulder mobility and controlled movement.";
  }

  if (prescription.id === "both-arm-raise") {
    return "Improve bilateral shoulder mobility and arm symmetry.";
  }

  if (prescription.id === "sit-to-stand") {
    return "Improve lower-body strength and sit-to-stand control.";
  }

  if (prescription.category === "upper_body") {
    return "Improve upper-body mobility and controlled movement.";
  }

  if (prescription.category === "transfer") {
    return "Improve transfer ability and movement confidence.";
  }

  return "Support safe and controlled therapeutic movement.";
}

function inferSessionGoal(exerciseIds: string[]): string {
  const set = new Set(exerciseIds);

  if (
    set.has("right-arm-raise") ||
    set.has("left-arm-raise") ||
    set.has("both-arm-raise")
  ) {
    if (set.has("sit-to-stand")) {
      return "Improve upper-body mobility, controlled movement, and functional transitions.";
    }

    return "Improve shoulder mobility, arm control, and upright posture.";
  }

  if (set.has("sit-to-stand")) {
    return "Improve lower-body strength, transfer ability, and balance.";
  }

  return "Support safe, guided rehabilitation movement.";
}

function getSessionPreview(
  session: TherapySession | null,
  prescriptions: ExercisePrescription[]
) {
  if (!session) return null;

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
      ): item is {
        id: string;
        displayName: string;
        prescription: ExercisePrescription;
        seconds: number;
      } => item !== null
    );

  const totalSeconds = items.reduce((sum, item) => sum + item.seconds, 0);
  const totalReps = items.reduce((sum, item) => sum + item.prescription.repTarget, 0);

  return {
    title: session.name,
    goal: inferSessionGoal(items.map((item) => item.id)),
    durationLabel: formatDurationRange(totalSeconds),
    totalExercises: items.length,
    totalReps,
    items
  };
}

function getExercisePreview(prescription: ExercisePrescription) {
  return {
    title: prescription.name,
    goal: inferExerciseGoal(prescription),
    durationLabel: formatDurationRange(estimateExerciseSeconds(prescription)),
    totalExercises: 1,
    totalReps: prescription.repTarget,
    items: [
      {
        id: prescription.id,
        displayName: prescription.name,
        prescription,
        seconds: estimateExerciseSeconds(prescription)
      }
    ]
  };
}

function getFramingText(prescription: ExercisePrescription): string {
  if (prescription.id === "sit-to-stand") {
    return "Frame your full body and chair clearly, with your hips and knees visible.";
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
  const sessionExerciseIndexRef = useRef(0);
  const activeSessionRef = useRef<TherapySession | null>(null);
  const selectedSessionRef = useRef<TherapySession | null>(null);

  const aiRequestInFlightRef = useRef(false);
  const aiEventTokenRef = useRef(0);
  const lastSpokenAtRef = useRef(0);

  const [runnerMode, setRunnerMode] = useState<RunnerMode>("session");
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(
    exercises[0]?.id ?? ""
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionExerciseIndex, setSessionExerciseIndex] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [aiCoachingEnabled, setAiCoachingEnabled] = useState(true);

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(null);
  const [coaching, setCoaching] = useState<CoachingDecision>(
    createIdleCoaching("session")
  );
  const [engineStatus, setEngineStatus] = useState<
    "idle" | "loading" | "running" | "error"
  >("idle");
  const [engineError, setEngineError] = useState("");

  useVoiceCoaching(coaching.message, {
    enabled: voiceEnabled,
    cooldownMs: 1800,
    rate: 0.92
  });

  const selectedSession = useMemo<TherapySession | null>(() => {
    return sessions.find((item) => item.id === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  const activeSession = useMemo<TherapySession | null>(() => {
    return sessions.find((item) => item.id === activeSessionId) ?? null;
  }, [sessions, activeSessionId]);

  const activeSessionExercise = useMemo(() => {
    if (!activeSession) return null;
    return activeSession.exercises[sessionExerciseIndex] ?? null;
  }, [activeSession, sessionExerciseIndex]);

  const manualPrescription = useMemo(() => {
    return exercises.find((item) => item.id === selectedExerciseId) ?? exercises[0];
  }, [selectedExerciseId, exercises]);

  const sessionPrescription = useMemo(() => {
    if (!activeSessionExercise) return null;
    return (
      exercises.find((item) => item.id === activeSessionExercise.prescriptionId) ?? null
    );
  }, [activeSessionExercise, exercises]);

  const prescription = sessionPrescription ?? manualPrescription;

  const sessionPreview = useMemo(() => {
    return getSessionPreview(selectedSession, exercises);
  }, [selectedSession, exercises]);

  const exercisePreview = useMemo(() => {
    return getExercisePreview(manualPrescription);
  }, [manualPrescription]);

  const preview = runnerMode === "session" ? sessionPreview : exercisePreview;

  useEffect(() => {
    if (!exercises.find((item) => item.id === selectedExerciseId) && exercises[0]) {
      setSelectedExerciseId(exercises[0].id);
    }
  }, [exercises, selectedExerciseId]);

  useEffect(() => {
    if (!selectedSessionId && sessions[0]) {
      setSelectedSessionId(sessions[0].id);
    } else if (
      selectedSessionId &&
      !sessions.find((item) => item.id === selectedSessionId)
    ) {
      setSelectedSessionId(sessions[0]?.id ?? "");
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    prescriptionRef.current = prescription;
  }, [prescription]);

  useEffect(() => {
    sessionExerciseIndexRef.current = sessionExerciseIndex;
  }, [sessionExerciseIndex]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    setCoaching(createIdleCoaching(runnerMode));
  }, [runnerMode]);

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
    setActiveMetricValue(null);
    setCoaching(createIdleCoaching(runnerMode));
  }

  function stopSessionMode() {
    clearAdvanceTimeout();
    setActiveSessionId(null);
    setSessionExerciseIndex(0);
    setSessionComplete(false);
    sessionExerciseIndexRef.current = 0;
    activeSessionRef.current = null;
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

    stopSessionMode();
    resetExerciseState();
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
        const currentActiveSession = activeSessionRef.current;

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

          if (output.isComplete && currentActiveSession && !advancePendingRef.current) {
            advancePendingRef.current = true;

            const nextIndex = sessionExerciseIndexRef.current + 1;
            const nextExercise = currentActiveSession.exercises[nextIndex] ?? null;

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
                setSessionExerciseIndex(nextIndex);
                sessionExerciseIndexRef.current = nextIndex;
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

  async function beginSelectedRun() {
    if (runnerMode === "session") {
      const sessionToStart = selectedSessionRef.current;
      if (!sessionToStart) return;

      const firstExercise = sessionToStart.exercises[0];
      if (!firstExercise) return;

      setActiveSessionId(sessionToStart.id);
      setSessionExerciseIndex(0);
      sessionExerciseIndexRef.current = 0;
      activeSessionRef.current = sessionToStart;
      setSessionComplete(false);
      setSelectedExerciseId(firstExercise.prescriptionId);
      resetExerciseState();

      setStickyCoaching(
        {
          code: "start_exercise",
          priority: "info",
          message: `Session started. Please step into view.`
        },
        1800
      );
    } else {
      stopSessionMode();
      setSessionComplete(false);
      resetExerciseState();

      setStickyCoaching(
        {
          code: "start_exercise",
          priority: "info",
          message: `Exercise started. Please step into view.`
        },
        1800
      );
    }

    try {
      await cameraRef.current?.startCamera();
    } catch {}
  }

  function endSession() {
    cameraRef.current?.stopCamera();
  }

  function stopCameraOnly() {
    cameraRef.current?.stopCamera();
  }

  function resetExercise() {
    clearAdvanceTimeout();
    resetExerciseState();
  }

  useEffect(() => {
    if (!activeSession) return;

    const current = activeSession.exercises[sessionExerciseIndex];
    if (current) {
      setSelectedExerciseId(current.prescriptionId);
    }
  }, [activeSession, sessionExerciseIndex]);

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, []);

  const sessionProgressLabel = activeSession
    ? `Exercise ${Math.min(sessionExerciseIndex + 1, activeSession.exercises.length)} of ${
        activeSession.exercises.length
      }`
    : "Single exercise";

  const currentExerciseLabel =
    activeSessionExercise?.displayName ?? prescription.name;

  const canBegin =
    runnerMode === "session" ? Boolean(selectedSession) : Boolean(manualPrescription);

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
            display: "grid",
            gridTemplateColumns: "220px minmax(260px, 320px) 1fr",
            gap: 16,
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
              Mode
            </div>

            <div
              style={{
                display: "flex",
                background: "#121933",
                borderRadius: 12,
                padding: 4,
                gap: 4
              }}
            >
              <button
                onClick={() => {
                  setRunnerMode("session");
                  stopSessionMode();
                  resetExerciseState();
                }}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background:
                    runnerMode === "session" ? "#7cc6ff" : "transparent",
                  color: runnerMode === "session" ? "#08111f" : "white",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Sessions
              </button>

              <button
                onClick={() => {
                  setRunnerMode("exercise");
                  stopSessionMode();
                  resetExerciseState();
                }}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background:
                    runnerMode === "exercise" ? "#7cc6ff" : "transparent",
                  color: runnerMode === "exercise" ? "#08111f" : "white",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Single Exercise
              </button>
            </div>
          </div>

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
              {runnerMode === "session" ? "Available Sessions" : "Available Exercises"}
            </div>

            {runnerMode === "session" ? (
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                disabled={engineStatus === "running" || engineStatus === "loading"}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#121933",
                  color: "white",
                  opacity:
                    engineStatus === "running" || engineStatus === "loading"
                      ? 0.65
                      : 1
                }}
              >
                <option value="">Select a session</option>
                {sessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedExerciseId}
                onChange={(e) => setSelectedExerciseId(e.target.value)}
                disabled={engineStatus === "running" || engineStatus === "loading"}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#121933",
                  color: "white",
                  opacity:
                    engineStatus === "running" || engineStatus === "loading"
                      ? 0.65
                      : 1
                }}
              >
                {exercises.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div
            style={{
              background: "#121933",
              borderRadius: 12,
              padding: 16,
              minHeight: 150
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#7cc6ff",
                marginBottom: 10,
                textTransform: "uppercase",
                letterSpacing: 0.6
              }}
            >
              Preview
            </div>

            {preview ? (
              <>
                <h3 style={{ marginTop: 0, marginBottom: 10 }}>{preview.title}</h3>

                <div style={{ color: "#d8e2ff", marginBottom: 10, lineHeight: 1.5 }}>
                  {preview.goal}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 14
                  }}
                >
                  <span
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: "rgba(124,198,255,0.12)",
                      color: "#7cc6ff",
                      fontSize: 12
                    }}
                  >
                    {preview.durationLabel}
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
                    {preview.totalExercises} exercise
                    {preview.totalExercises === 1 ? "" : "s"}
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
                    {preview.totalReps} total reps
                  </span>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {preview.items.map((item, index) => (
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
                Select a session to preview what is included.
              </div>
            )}
          </div>
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr",
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
              flexWrap: "wrap",
              marginBottom: 14
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

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 14
            }}
          >
            <button
              onClick={beginSelectedRun}
              disabled={!canBegin || engineStatus === "running" || engineStatus === "loading"}
              style={{
                background: "#9be7b0",
                color: "#08111f",
                fontWeight: 700,
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor:
                  canBegin && engineStatus !== "running" && engineStatus !== "loading"
                    ? "pointer"
                    : "not-allowed",
                opacity:
                  canBegin && engineStatus !== "running" && engineStatus !== "loading"
                    ? 1
                    : 0.5
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
              onClick={resetExercise}
              disabled={engineStatus === "idle"}
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: engineStatus !== "idle" ? "pointer" : "not-allowed",
                opacity: engineStatus !== "idle" ? 1 : 0.5
              }}
            >
              Reset
            </button>

            <button
              onClick={stopCameraOnly}
              disabled={engineStatus !== "running" && engineStatus !== "error"}
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "white",
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
              Stop Camera
            </button>
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
            {getFramingText(prescription)}
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
            repTarget={prescription.repTarget}
            exerciseName={currentExerciseLabel}
            progressLabel={activeSession ? sessionProgressLabel : "Single exercise mode"}
            minHeight={300}
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

            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              <div>
                Current exercise: <strong>{currentExerciseLabel}</strong>
              </div>
              <div>
                Progress: <strong>{activeSession ? sessionProgressLabel : `${repCount}/${prescription.repTarget} reps`}</strong>
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
