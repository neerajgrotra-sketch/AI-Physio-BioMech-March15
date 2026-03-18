"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import CameraViewport, {
  type CameraViewportHandle
} from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import CoachingPanel from "@/components/coaching/CoachingPanel";
import DebugPanel from "@/components/debug/DebugPanel";
import { useSessionLibrary } from "@/components/providers/SessionLibraryProvider";

import { ACTIVE_EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement } from "@/lib/interpreter/movementInterpreter";
import { buildCoachingDecision } from "@/lib/coaching/coachingPolicy";
import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";

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
    message: "Start the camera and step into frame."
  };
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

  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(
    exercises[0]?.id ?? ""
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionExerciseIndex, setSessionExerciseIndex] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(null);
  const [coaching, setCoaching] = useState<CoachingDecision>(createIdleCoaching());
  const [engineStatus, setEngineStatus] = useState<"idle" | "loading" | "running" | "error">(
    "idle"
  );
  const [engineError, setEngineError] = useState("");

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

  useEffect(() => {
    if (!exercises.find((item) => item.id === selectedExerciseId) && exercises[0]) {
      setSelectedExerciseId(exercises[0].id);
    }
  }, [exercises, selectedExerciseId]);

  useEffect(() => {
    if (!selectedSessionId && sessions[0]) {
      setSelectedSessionId(sessions[0].id);
    } else if (selectedSessionId && !sessions.find((item) => item.id === selectedSessionId)) {
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

    setRepCount(0);
    setPhase("ready");
    setActiveMetricValue(null);
    setCoaching(createIdleCoaching());
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

          setRepCount(output.repState.repCount);
          setPhase(output.repState.phase);
          setActiveMetricValue(output.activeMetricValue);

          const now = Date.now();

          if (output.isComplete && currentActiveSession && !advancePendingRef.current) {
            advancePendingRef.current = true;

            const nextIndex = sessionExerciseIndexRef.current + 1;
            const nextExercise = currentActiveSession.exercises[nextIndex] ?? null;

            if (nextExercise) {
              setStickyCoaching(
                {
                  code: "exercise_complete",
                  priority: "encourage",
                  message: `Exercise complete. Next: ${nextExercise.displayName}`
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
          } else if (output.repState.justFailedRep) {
            const failureDecision = buildCoachingDecision(output, activePrescription);
            setStickyCoaching(
              {
                ...failureDecision,
                message: `${failureDecision.message} Begin again when ready.`
              },
              2600
            );
          } else if (output.repState.justCompletedRep) {
            setStickyCoaching(
              {
                code: "good_rep",
                priority: "encourage",
                message: `${activePrescription.coaching.success} Begin again when ready.`
              },
              1800
            );
          } else if (output.repState.justCompletedHold) {
            setStickyCoaching(
              {
                code: "hold_complete",
                priority: "encourage",
                message: activePrescription.coaching.lower
              },
              1200
            );
          } else if (output.holdRemainingMs !== null) {
            const seconds = Math.max(1, Math.ceil(output.holdRemainingMs / 1000));
            setCoaching({
              code: "keep_holding",
              priority: "info",
              message: `Hold ${seconds}`
            });
          } else if (stickyCoachingRef.current && now < stickyCoachingUntilRef.current) {
            setCoaching(stickyCoachingRef.current);
          } else {
            stickyCoachingRef.current = null;
            stickyCoachingUntilRef.current = 0;
            setCoaching(buildCoachingDecision(output, activePrescription));
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

  async function startSelectedSession() {
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
        message: `Session started: ${sessionToStart.name}`
      },
      1800
    );

    try {
      await cameraRef.current?.startCamera();
    } catch {}
  }

  function exitSessionMode() {
    stopSessionMode();
    resetExerciseState();
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
    resetExerciseState();
  }, [selectedExerciseId]);

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, []);

  const sessionProgressLabel = activeSession
    ? `Exercise ${Math.min(sessionExerciseIndex + 1, activeSession.exercises.length)} of ${
        activeSession.exercises.length
      }`
    : "Manual exercise mode";

  return (
    <div style={{ marginTop: 30 }}>
      <h2>Session Runner</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 20,
          alignItems: "start"
        }}
      >
        <section
          style={{
            background: "#1a2040",
            padding: 20,
            borderRadius: 12,
            minHeight: 400
          }}
        >
          <h3 style={{ marginTop: 0 }}>Vision Surface</h3>
          <p style={{ color: "#aab6d3" }}>
            Start a session or use manual exercise mode.
          </p>

          <div style={{ position: "relative", width: "100%", maxWidth: 640 }}>
            <CameraViewport
              ref={cameraRef}
              onVideoReady={beginTracking}
              onCameraStop={stopTracking}
              showStartButton={!activeSession}
            />

            <div
              style={{
                position: "absolute",
                left: 0,
                top: 52,
                width: "100%",
                maxWidth: 640,
                height: 420,
                pointerEvents: "none"
              }}
            >
              <PoseCanvasOverlay frame={frame} width={640} height={420} />
            </div>
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <CoachingPanel title="Coaching" message={coaching.message} />

          <section
            style={{
              background: "#1a2040",
              padding: 20,
              borderRadius: 12
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(124,198,255,0.12)",
                color: "#7cc6ff",
                fontSize: 12,
                marginBottom: 12
              }}
            >
              Session Control
            </div>

            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 14 }}>Saved Session</span>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#121933",
                  color: "white"
                }}
              >
                <option value="">Select a saved session</option>
                {sessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={startSelectedSession}
                disabled={!selectedSession}
                style={{
                  background: "#9be7b0",
                  color: "#08111f",
                  fontWeight: 700,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  cursor: selectedSession ? "pointer" : "not-allowed",
                  opacity: selectedSession ? 1 : 0.5
                }}
              >
                Start Session
              </button>

              <button
                onClick={exitSessionMode}
                disabled={!activeSession}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  cursor: activeSession ? "pointer" : "not-allowed",
                  opacity: activeSession ? 1 : 0.5
                }}
              >
                Exit Session
              </button>
            </div>

            <div style={{ marginTop: 12, fontSize: 14, color: "#aab6d3" }}>
              {activeSession ? (
                <>
                  <div>
                    Session: <strong style={{ color: "white" }}>{activeSession.name}</strong>
                  </div>
                  <div>
                    Progress: <strong style={{ color: "white" }}>{sessionProgressLabel}</strong>
                  </div>
                  {activeSessionExercise && (
                    <div>
                      Current item:{" "}
                      <strong style={{ color: "white" }}>
                        {activeSessionExercise.displayName}
                      </strong>
                    </div>
                  )}
                  {sessionComplete && (
                    <div style={{ color: "#9be7b0", marginTop: 6 }}>
                      Session complete.
                    </div>
                  )}
                </>
              ) : (
                <div>Manual exercise mode</div>
              )}
            </div>
          </section>

          <section
            style={{
              background: "#1a2040",
              padding: 20,
              borderRadius: 12
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(124,198,255,0.12)",
                color: "#7cc6ff",
                fontSize: 12,
                marginBottom: 12
              }}
            >
              Current Exercise
            </div>

            <div style={{ marginBottom: 14 }}>
              <label
                htmlFor="exercise-select"
                style={{ display: "block", marginBottom: 6, fontSize: 14 }}
              >
                Exercise
              </label>
              <select
                id="exercise-select"
                value={selectedExerciseId}
                onChange={(e) => setSelectedExerciseId(e.target.value)}
                disabled={!!activeSession}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#121933",
                  color: "white",
                  opacity: activeSession ? 0.65 : 1
                }}
              >
                {exercises.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <h3 style={{ marginTop: 0 }}>{prescription.name}</h3>
            <p style={{ color: "#aab6d3", marginBottom: 10 }}>{prescription.description}</p>

            <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
              <div>
                Target: <strong>{prescription.target.label}</strong>
              </div>
              {prescription.hold.required && (
                <div>
                  Hold: <strong>{prescription.hold.durationMs / 1000}s</strong>
                </div>
              )}
              <div>
                Reps: <strong>{prescription.repTarget}</strong>
              </div>
              {prescription.tempo?.label && (
                <div>
                  Tempo: <strong>{prescription.tempo.label}</strong>
                </div>
              )}
              <div>
                Template: <strong>{prescription.template}</strong>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 14, fontSize: 14 }}>
              <div>
                Engine status: <strong>{engineStatus}</strong>
              </div>
              <div>
                Phase: <strong>{phase}</strong>
              </div>
              <div>
                Reps done: <strong>{repCount} / {prescription.repTarget}</strong>
              </div>
              <div>
                Active metric: <strong>{activeMetricValue ?? "—"}</strong>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                onClick={resetExercise}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  color: "white"
                }}
              >
                Reset Exercise
              </button>
            </div>

            {engineError && (
              <p style={{ color: "#ff8f8f", marginBottom: 0 }}>{engineError}</p>
            )}
          </section>

          <DebugPanel features={features} />
        </div>
      </div>
    </div>
  );
}
