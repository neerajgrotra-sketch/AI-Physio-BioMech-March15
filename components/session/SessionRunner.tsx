"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import CameraViewport, {
  type CameraViewportHandle
} from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
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

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { TherapySession } from "@/lib/sessions/sessionTypes";

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

type LiveObservation = {
  visibilityLines: string[];
  movementLines: string[];
};

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

function getExerciseRequirement(prescription: ExercisePrescription | null): string {
  if (!prescription) return "No exercise selected.";

  switch (prescription.id) {
    case "right-arm-raise":
      return "Lift your right arm to shoulder height, hold, then lower slowly.";
    case "left-arm-raise":
      return "Lift your left arm to shoulder height, hold, then lower slowly.";
    case "both-arm-raise":
      return "Lift both arms evenly to shoulder height, hold, then lower slowly.";
    case "sit-to-stand":
      return "Stand up fully, hold briefly, then lower back to the seat slowly.";
    default:
      return `Perform ${prescription.name} with slow, controlled movement.`;
  }
}

function getPositionRequirement(prescription: ExercisePrescription | null): string {
  if (!prescription) return "Not specified";

  switch (prescription.id) {
    case "sit-to-stand":
      return "Start seated, then stand fully and return to seated.";
    case "right-arm-raise":
    case "left-arm-raise":
    case "both-arm-raise":
      return "Remain upright. Seated upright or standing is acceptable.";
    default:
      return "Remain upright and centered in view.";
  }
}

function getExerciseDisplayName(item: PreviewExerciseItem | null): string {
  return item?.displayName ?? "No active exercise";
}

function getVisibleLandmarkNames(frame: PoseFrame | null): Set<string> {
  const names = new Set<string>();
  const landmarks = (frame as any)?.landmarks ?? null;

  if (!landmarks || typeof landmarks !== "object") {
    return names;
  }

  for (const [key, value] of Object.entries(landmarks)) {
    const point = value as { x?: number; y?: number; score?: number | null };
    if (
      typeof point?.x === "number" &&
      typeof point?.y === "number" &&
      (point.score ?? 1) >= 0.15
    ) {
      names.add(key);
    }
  }

  return names;
}

function buildVisibilityLines(
  frame: PoseFrame | null,
  readinessMessage: string,
  readinessReady: boolean
): string[] {
  const lines: string[] = [];
  const names = getVisibleLandmarkNames(frame);
  const personDetected = Boolean((frame as any)?.personDetected);

  if (!personDetected) {
    return ["No person detected in frame."];
  }

  lines.push("Person detected.");

  const headVisible = names.has("nose");
  const shouldersVisible = names.has("left_shoulder") && names.has("right_shoulder");
  const elbowsVisible = names.has("left_elbow") || names.has("right_elbow");
  const wristsVisible = names.has("left_wrist") || names.has("right_wrist");
  const hipsVisible = names.has("left_hip") && names.has("right_hip");
  const kneesVisible = names.has("left_knee") || names.has("right_knee");

  lines.push(headVisible ? "Head visible." : "Head not clearly visible.");
  lines.push(shouldersVisible ? "Shoulders visible." : "Shoulders not clearly visible.");
  lines.push(elbowsVisible ? "At least one elbow visible." : "Elbows not clearly visible.");
  lines.push(wristsVisible ? "At least one wrist visible." : "Wrists not clearly visible.");
  lines.push(hipsVisible ? "Torso and hips visible." : "Hips not clearly visible.");
  lines.push(kneesVisible ? "Lower body partially visible." : "Lower body mostly out of frame.");

  lines.push(readinessReady ? "Framing is acceptable." : readinessMessage);

  return lines;
}

function buildMovementLines(
  prescription: ExercisePrescription | null,
  phase: string,
  features: MovementFeatures,
  repCount: number,
  holdRemainingMs: number | null,
  primaryIssue: string,
  activeMetricValue: number | null
): string[] {
  const lines: string[] = [];

  if (features.isStanding) {
    lines.push("User appears to be standing.");
  } else if (features.isSeated) {
    lines.push("User appears to be seated.");
  } else {
    lines.push("Posture state is not fully clear yet.");
  }

  switch (phase) {
    case "ready":
      lines.push("Movement status: ready to begin.");
      break;
    case "lifting":
      lines.push("Movement status: lifting phase.");
      break;
    case "holding":
      lines.push("Movement status: hold in progress.");
      break;
    case "lowering":
      lines.push("Movement status: lowering phase.");
      break;
    case "complete":
      lines.push("Movement status: exercise complete.");
      break;
    default:
      lines.push("Movement status: tracking.");
      break;
  }

  if (prescription?.id === "right-arm-raise") {
    const angle = features.rightArmElevationDeg;
    if (angle !== null) {
      if (angle < 35) lines.push("Right arm is still below target height.");
      else if (angle < 75) lines.push("Right arm is approaching shoulder height.");
      else lines.push("Right arm is near or above target height.");
    }
  } else if (prescription?.id === "left-arm-raise") {
    const angle = features.leftArmElevationDeg;
    if (angle !== null) {
      if (angle < 35) lines.push("Left arm is still below target height.");
      else if (angle < 75) lines.push("Left arm is approaching shoulder height.");
      else lines.push("Left arm is near or above target height.");
    }
  } else if (prescription?.id === "both-arm-raise") {
    const angle = features.bilateralArmElevationDeg;
    if (angle !== null) {
      if (angle < 35) lines.push("Both arms are still below target height.");
      else if (angle < 75) lines.push("Both arms are approaching shoulder height.");
      else lines.push("Both arms are near or above target height.");
    }
  } else if (prescription?.id === "sit-to-stand") {
    lines.push(features.isStanding ? "User is near the standing position." : "User is near the seated position.");
  }

  if (holdRemainingMs !== null && phase === "holding") {
    lines.push(`Hold time remaining: ${Math.max(1, Math.ceil(holdRemainingMs / 1000))} second(s).`);
  }

  lines.push(`Rep count: ${repCount} completed.`);

  if (activeMetricValue !== null) {
    lines.push(`Active metric value: ${activeMetricValue.toFixed(1)}.`);
  }

  if (primaryIssue && primaryIssue !== "idle") {
    lines.push(`Primary quality note: ${primaryIssue.replaceAll("_", " ")}.`);
  }

  return lines;
}

function buildFramingBanner(
  prescription: ExercisePrescription | null,
  readinessMessage: string,
  readinessReady: boolean,
  personDetected: boolean,
  features: MovementFeatures,
  calibrationComplete: boolean
): FramingBannerState {
  if (!personDetected) {
    return {
      tone: "warning",
      message: "Step into view so I can see you properly."
    };
  }

  if (isCalibrationExercise(prescription) && !calibrationComplete) {
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
      message: hasPassedArmRaiseCalibration(features)
        ? "Framing confirmed."
        : "Lift both arms once so I can verify framing."
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

function getInstructionTitle(item: PreviewExerciseItem | null): string {
  return item?.displayName ?? "Session Instructions";
}

function getInstructionBody(
  prescription: ExercisePrescription | null,
  totalReps: number
): string {
  if (!prescription) {
    return "Choose a session and begin when ready.";
  }

  const holdSec = prescription.hold.required
    ? Math.round(prescription.hold.durationMs / 1000)
    : 0;

  const requirement = getExerciseRequirement(prescription);
  const holdLine = holdSec > 0 ? ` Hold each rep for ${holdSec} second(s).` : "";
  return `${requirement} Target: ${totalReps} rep(s).${holdLine}`;
}

interface SessionRunnerProps {
  prescriptionQueue?: import("@/lib/types/exercise").ExercisePrescription[];
  sessionTitle?: string;
}

export default function SessionRunner({ prescriptionQueue, sessionTitle }: SessionRunnerProps = {}) {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;

  const cameraRef = useRef<CameraViewportHandle | null>(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const advanceTimeoutRef = useRef<number | null>(null);

  const trackingActiveRef = useRef(false);
  const repStateRef = useRef<RuntimeRepState>(createInitialRepState());
  const featureHistoryRef = useRef(new FeatureHistory(5));
  const prescriptionRef = useRef<ExercisePrescription | null>(null);
  const activeQueueRef = useRef<PreviewExerciseItem[]>([]);
  const queueIndexRef = useRef(0);
  const calibrationCompleteRef = useRef(false);
  const advancePendingRef = useRef(false);

  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(false);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [phase, setPhase] = useState("ready");
  const [repCount, setRepCount] = useState(0);
  const [holdRemainingMs, setHoldRemainingMs] = useState<number | null>(null);
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(null);
  const [framingBanner, setFramingBanner] = useState<FramingBannerState>({
    tone: "warning",
    message: "Camera is off."
  });
  const [framingCalibrated, setFramingCalibrated] = useState(false);
  const [engineStatus, setEngineStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [engineError, setEngineError] = useState("");
  const [liveObservation, setLiveObservation] = useState<LiveObservation>({
    visibilityLines: ["Camera is off."],
    movementLines: ["No movement is being tracked yet."]
  });
  const [lastPrimaryIssue, setLastPrimaryIssue] = useState("idle");

  const selectedSessions = useMemo(() => {
    return sessions.filter((session) => selectedSessionIds.includes(session.id));
  }, [sessions, selectedSessionIds]);

  const sessionPreviews = useMemo(() => {
    return selectedSessions.map((session) => buildSessionPreviewData(session, exercises));
  }, [selectedSessions, exercises]);

  const combinedQueue = useMemo(() => {
    // If a prescription queue was passed in (from Supabase), use it directly
    if (prescriptionQueue && prescriptionQueue.length > 0) {
      return prescriptionQueue.map((p) => ({
        id: p.id,
        displayName: p.name,
        prescription: p,
        seconds: p.repTarget * ((p.hold?.durationMs ?? 2000) / 1000 + 5),
        sessionName: sessionTitle ?? "Session",
      }));
    }
    return sessionPreviews.flatMap((preview) => preview.items);
  }, [sessionPreviews, prescriptionQueue, sessionTitle]);

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

  function resetTrackingState() {
    repStateRef.current = createInitialRepState();
    featureHistoryRef.current.clear();
    calibrationCompleteRef.current = false;
    advancePendingRef.current = false;

    setFramingCalibrated(false);
    setPhase("ready");
    setRepCount(0);
    setHoldRemainingMs(null);
    setActiveMetricValue(null);
    setLastPrimaryIssue("idle");
    setLiveObservation({
      visibilityLines: ["Waiting for camera input."],
      movementLines: ["No movement is being tracked yet."]
    });
  }

  function stopTracking() {
    trackingActiveRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    clearAdvanceTimeout();
    videoRef.current = null;
    activeQueueRef.current = [];
    queueIndexRef.current = 0;
    prescriptionRef.current = null;

    setEngineStatus("idle");
    setEngineError("");
    setSessionStarted(false);
    setSessionComplete(false);
    setFrame(null);
    setFeatures(createEmptyFeatures());
    setFramingBanner({
      tone: "warning",
      message: "Camera is off."
    });

    resetTrackingState();
  }

  async function beginTracking(video: HTMLVideoElement) {
    try {
      setEngineStatus("loading");
      setEngineError("");
      videoRef.current = video;
      trackingActiveRef.current = true;

      resetTrackingState();

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

          repStateRef.current = output.repState;

          setPhase(output.repState.phase);
          setRepCount(output.repState.repCount);
          setHoldRemainingMs(output.holdRemainingMs);
          setActiveMetricValue(output.activeMetricValue);
          setLastPrimaryIssue(output.primaryIssue);

          const readiness = evaluateReadiness({
            frame: normalized,
            features: smoothedFeatures,
            prescription: activePrescription,
            averageBrightness: null
          });

          const personDetected = Boolean((normalized as any)?.personDetected);

          if (
            isCalibrationExercise(activePrescription) &&
            !calibrationCompleteRef.current &&
            personDetected &&
            readiness.checks.upperBodyVisible &&
            hasPassedArmRaiseCalibration(smoothedFeatures)
          ) {
            calibrationCompleteRef.current = true;
            setFramingCalibrated(true);
          }

          const calibrationComplete =
            !isCalibrationExercise(activePrescription) || calibrationCompleteRef.current;

          setFramingBanner(
            buildFramingBanner(
              activePrescription,
              readiness.message,
              readiness.ready,
              personDetected,
              smoothedFeatures,
              calibrationComplete
            )
          );

          setLiveObservation({
            visibilityLines: buildVisibilityLines(
              normalized,
              readiness.message,
              readiness.ready
            ),
            movementLines: buildMovementLines(
              activePrescription,
              output.repState.phase,
              smoothedFeatures,
              output.repState.repCount,
              output.holdRemainingMs,
              output.primaryIssue,
              output.activeMetricValue
            )
          });

          if (output.isComplete && !advancePendingRef.current) {
            advancePendingRef.current = true;

            const nextIndex = queueIndexRef.current + 1;
            const nextExercise = activeQueueRef.current[nextIndex] ?? null;

            if (nextExercise) {
              clearAdvanceTimeout();
              advanceTimeoutRef.current = window.setTimeout(() => {
                queueIndexRef.current = nextIndex;
                prescriptionRef.current = nextExercise.prescription;
                resetTrackingState();
              }, 1200);
            } else {
              setSessionComplete(true);
            }
          }
        } catch (error) {
          if (!trackingActiveRef.current) return;

          const message = error instanceof Error ? error.message : String(error);

          if (
            message.toLowerCase().includes("aborted") ||
            message.toLowerCase().includes("abort")
          ) {
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

    activeQueueRef.current = combinedQueue;
    queueIndexRef.current = 0;
    prescriptionRef.current = combinedQueue[0].prescription;

    setSessionStarted(true);
    setSessionComplete(false);
    setSelectorCollapsed(true);
    setStatusCollapsed(false);
    setFramingBanner({
      tone: "warning",
      message: "Position yourself in view."
    });

    resetTrackingState();

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

    if (sessionStarted && activeQueueRef.current[0]) {
      queueIndexRef.current = 0;
      prescriptionRef.current = activeQueueRef.current[0].prescription;
    }

    setSessionComplete(false);
    resetTrackingState();

    setFramingBanner({
      tone: "warning",
      message: sessionStarted ? "Position yourself in view." : "Camera is off."
    });
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

  const currentExerciseLabel = getExerciseDisplayName(currentQueueItem);
  const overallProgressLabel =
    activeQueueRef.current.length > 0
      ? `Exercise ${Math.min(queueIndexRef.current + 1, activeQueueRef.current.length)} of ${activeQueueRef.current.length}`
      : "No session selected";

  const instructionBody = getInstructionBody(
    currentPrescription,
    currentPrescription?.repTarget ?? 0
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "#d8e2ff", marginBottom: 6, fontSize: 14 }}>
        Movement Intelligence platform for physiotherapy.
      </div>

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
          alignItems: "start"
        }}
      >
        <section
          style={{
            background: "#1a2040",
            padding: 20,
            borderRadius: 14,
            minHeight: 540,
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
              {formatPhase(phase)}
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

        <section
          style={{
            display: "grid",
            gap: 16
          }}
        >
          <div
            style={{
              background: "#1a2040",
              padding: 20,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap"
              }}
            >
              <h2 style={{ margin: 0 }}>Live Coaching</h2>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: "rgba(124,198,255,0.12)",
                    color: "#7cc6ff",
                    fontSize: 12,
                    fontWeight: 700
                  }}
                >
                  {formatPhase(phase)}
                </span>

                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 700
                  }}
                >
                  {currentPrescription?.repTarget ? `Rep ${repCount}/${currentPrescription.repTarget}` : "Rep 0/0"}
                </span>

                {holdRemainingMs !== null && phase === "holding" && (
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      background: "rgba(100,220,150,0.15)",
                      color: "#9be7b0",
                      fontSize: 12,
                      fontWeight: 700
                    }}
                  >
                    Hold {Math.max(1, Math.ceil(holdRemainingMs / 1000))}s
                  </span>
                )}
              </div>
            </div>

            <div
              style={{
                background: "#101833",
                borderRadius: 12,
                padding: 20,
                minHeight: 180,
                border: "1px solid rgba(255,255,255,0.06)"
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginBottom: 16 }}>
                {getInstructionTitle(currentQueueItem)}
              </div>

              <div style={{ fontSize: 18, lineHeight: 1.5, color: "#e6ecff", marginBottom: 14 }}>
                {instructionBody}
              </div>

              <div style={{ display: "grid", gap: 8, color: "#c7d3f5", fontSize: 15 }}>
                <div>
                  <strong>Required position:</strong> {getPositionRequirement(currentPrescription)}
                </div>
                <div>
                  <strong>Progress:</strong> {overallProgressLabel}
                </div>
                <div>
                  <strong>Session state:</strong> {sessionComplete ? "Session complete." : "In progress"}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              background: "#1a2040",
              padding: 20,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)"
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>What the camera sees</h3>
            <div
              style={{
                background: "#101833",
                borderRadius: 12,
                padding: 16,
                border: "1px solid rgba(255,255,255,0.06)",
                marginBottom: 14
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Visibility</div>
              <div style={{ display: "grid", gap: 8 }}>
                {liveObservation.visibilityLines.map((line, index) => (
                  <div key={`vis-${index}`} style={{ color: "#d8e2ff", lineHeight: 1.45 }}>
                    • {line}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: "#101833",
                borderRadius: 12,
                padding: 16,
                border: "1px solid rgba(255,255,255,0.06)"
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Natural-language movement status</div>
              <div style={{ display: "grid", gap: 8 }}>
                {liveObservation.movementLines.map((line, index) => (
                  <div key={`move-${index}`} style={{ color: "#d8e2ff", lineHeight: 1.45 }}>
                    • {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
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
                Current session progress and technical status.
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
                Framing:
                <div style={{ fontWeight: 700, marginTop: 4 }}>
                  {framingCalibrated ? "Confirmed" : "Pending / not required"}
                </div>
              </div>

              <div>
                Primary issue:
                <div style={{ fontWeight: 700, marginTop: 4 }}>
                  {lastPrimaryIssue.replaceAll("_", " ")}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <OpenAiConnectivityPanel />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
