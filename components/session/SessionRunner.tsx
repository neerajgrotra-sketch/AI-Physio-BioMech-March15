"use client";

// ============================================================
// components/session/SessionRunner.tsx
// ============================================================
// Thin UI compositor.
//
// SessionRunner no longer contains logic. It:
// 1. Reads from hooks
// 2. Passes events to hooks
// 3. Renders the three panels
//
// All logic lives in:
// - useSessionQueue    → exercise queue and progression
// - useInferenceLoop  → camera loop and movement interpretation
// - useFramingIntelligence → framing monitor and AI framing
// - useCoachingBrain  → observation buffer and AI coaching
// - usePatientContext → session memory and rep tracking
// ============================================================

import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback
} from "react";

import CameraViewport, {
  type CameraViewportHandle
} from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import PatientProfileSelector from "@/components/session/PatientProfileSelector";

import { useSessionLibrary } from "@/components/providers/SessionLibraryProvider";
import { ACTIVE_EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import { evaluateReadiness } from "@/lib/engine/readinessEngine";

import {
  useSessionQueue,
  buildQueueFromSessions,
  inferSessionGoal,
  formatDurationRange,
  type QueueItem
} from "@/lib/session/useSessionQueue";

import {
  useInferenceLoop,
  createEmptyFeatures
} from "@/lib/session/useInferenceLoop";

import { useFramingIntelligence } from "@/lib/framing/useFramingIntelligence";
import { useCoachingBrain } from "@/lib/coaching/useCoachingBrain";
import { usePatientContext } from "@/lib/patient/usePatientContext";
import { createDefaultPatientProfile } from "@/lib/patient/patientTypes";

import type { PatientProfile } from "@/lib/patient/patientTypes";

// ============================================================
// HELPERS
// ============================================================

function formatPhase(phase: string): string {
  const labels: Record<string, string> = {
    lifting: "Lift",
    holding: "Hold",
    lowering: "Lower",
    ready: "Ready",
    complete: "Complete"
  };
  return labels[phase] ?? "Tracking";
}

function getExerciseRequirement(id: string | undefined): string {
  switch (id) {
    case "right-arm-raise":
      return "Lift your right arm to shoulder height, hold, then lower slowly.";
    case "left-arm-raise":
      return "Lift your left arm to shoulder height, hold, then lower slowly.";
    case "both-arm-raise":
      return "Lift both arms evenly to shoulder height, hold, then lower slowly.";
    case "sit-to-stand":
      return "Stand up fully, hold briefly, then lower back to the seat slowly.";
    default:
      return "Perform the exercise with slow, controlled movement.";
  }
}

function getPositionRequirement(id: string | undefined): string {
  switch (id) {
    case "sit-to-stand":
      return "Start seated, then stand fully and return to seated.";
    case "right-arm-raise":
    case "left-arm-raise":
    case "both-arm-raise":
      return "Remain upright. Seated or standing is acceptable.";
    default:
      return "Remain upright and centered in view.";
  }
}

// ============================================================
// SESSION RUNNER
// ============================================================

export default function SessionRunner() {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;

  const cameraRef = useRef<CameraViewportHandle | null>(null);

  // ---- Patient profile state (UI-controlled) ----
  const [patientProfile, setPatientProfile] = useState<PatientProfile>(
    createDefaultPatientProfile()
  );

  // ---- Session selection UI state ----
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(false);

  // ---- Hooks ----
  const sessionQueue = useSessionQueue();

  const inferenceLoop = useInferenceLoop();

  const framingIntelligence = useFramingIntelligence(patientProfile);

  const coachingBrain = useCoachingBrain();

  const patientContext = usePatientContext(patientProfile);

  // ---- Auto-select first session ----
  useEffect(() => {
    if (selectedSessionIds.length === 0 && sessions[0]) {
      setSelectedSessionIds([sessions[0].id]);
    }
  }, [sessions, selectedSessionIds.length]);

  // ============================================================
  // COMBINED QUEUE PREVIEW
  // ============================================================

  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedSessionIds.includes(s.id)),
    [sessions, selectedSessionIds]
  );

  const combinedQueue = useMemo(
    () => buildQueueFromSessions(selectedSessions, exercises),
    [selectedSessions, exercises]
  );

  const combinedDurationSeconds = useMemo(
    () => combinedQueue.reduce((sum, item) => sum + item.seconds, 0),
    [combinedQueue]
  );

  const combinedTotalReps = useMemo(
    () =>
      combinedQueue.reduce(
        (sum, item) => sum + item.prescription.repTarget,
        0
      ),
    [combinedQueue]
  );

  const combinedGoal = useMemo(
    () => inferSessionGoal(combinedQueue.map((item) => item.id)),
    [combinedQueue]
  );

  // ============================================================
  // READINESS EVALUATOR (passed to inference loop)
  // ============================================================

  const readinessEvaluator = useCallback(
    (frame: any, features: any, prescription: any) => {
      const result = evaluateReadiness({ frame, features, prescription, averageBrightness: null });
      return { ready: result.ready, message: result.message };
    },
    []
  );

  // ============================================================
  // COACHING CALLBACKS (passed to inference loop)
  // ============================================================

  const coachingCallbacks = useMemo(() => ({
    onRepCompleted: (nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const profile = patientProfile;
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      if (!prescription || !exerciseCtx) return;

      patientContext.recordRepOutcome("success", null, null);

      coachingBrain.onRepCompleted({
        prescription,
        patientProfile: profile,
        exerciseContext: exerciseCtx,
        nowMs
      });
    },

    onRepFailed: (failureReason: string, nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const profile = patientProfile;
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      if (!prescription || !exerciseCtx) return;

      patientContext.recordRepOutcome("failed", failureReason, null);

      coachingBrain.onRepFailed({
        prescription,
        patientProfile: profile,
        exerciseContext: exerciseCtx,
        failureReason,
        nowMs
      });
    },

    onHoldStarted: (holdRequiredMs: number, nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const profile = patientProfile;
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      if (!prescription || !exerciseCtx) return;

      coachingBrain.onHoldStarted({
        prescription,
        patientProfile: profile,
        exerciseContext: exerciseCtx,
        holdRequiredMs,
        nowMs
      });
    },

    onExerciseStarted: (nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const profile = patientProfile;
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      if (!prescription || !exerciseCtx) return;

      coachingBrain.onExerciseStarted({
        prescription,
        patientProfile: profile,
        exerciseContext: exerciseCtx,
        nowMs
      });
    },

    feedFrame: (params: {
      phase: string;
      repCount: number;
      holdElapsedMs: number | null;
      holdRequiredMs: number | null;
      primaryIssue: string;
      armElevation?: number | null;
      nowMs: number;
    }) => {
      const prescription = sessionQueue.getActivePrescription();
      const profile = patientProfile;
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      if (!prescription || !exerciseCtx) return;

      coachingBrain.feedFrame({
        ...params,
        prescription,
        patientProfile: profile,
        exerciseContext: exerciseCtx
      });
    }
  }), [
    sessionQueue,
    patientProfile,
    patientContext,
    coachingBrain
  ]);

  const framingCallbacks = useMemo(() => ({
    evaluateFraming: framingIntelligence.evaluateFraming
  }), [framingIntelligence.evaluateFraming]);

  // ============================================================
  // EXERCISE COMPLETE HANDLER
  // ============================================================

  const handleExerciseComplete = useCallback(() => {
    const prescription = sessionQueue.getActivePrescription();
    const exerciseCtx = patientContext.getCurrentExerciseContext();

    if (prescription && exerciseCtx) {
      coachingBrain.onExerciseCompleting({
        prescription,
        patientProfile,
        exerciseContext: exerciseCtx,
        nowMs: Date.now()
      });
    }

    patientContext.completeExercise();

    sessionQueue.advanceQueue(
      (nextItem: QueueItem, nextIndex: number) => {
        // New exercise started
        inferenceLoop.resetTrackingState();
        framingIntelligence.reset("Position yourself for the next exercise.");

        patientContext.beginExercise(
          nextItem.prescription,
          nextIndex,
          sessionQueue.getActiveQueue().length
        );

        framingIntelligence.forcePreExerciseCheck(
          null,
          createEmptyFeatures(),
          nextItem.prescription,
          Date.now()
        );
      },
      () => {
        // Session complete
      }
    );
  }, [
    sessionQueue,
    patientContext,
    coachingBrain,
    patientProfile,
    inferenceLoop,
    framingIntelligence
  ]);

  // ============================================================
  // SESSION LIFECYCLE
  // ============================================================

  async function beginCombinedSession() {
    if (combinedQueue.length === 0) return;

    const started = sessionQueue.beginSession(combinedQueue);
    if (!started) return;

    setSelectorCollapsed(true);
    setStatusCollapsed(false);

    patientContext.beginSession();
    patientContext.beginExercise(
      combinedQueue[0].prescription,
      0,
      combinedQueue.length
    );

    framingIntelligence.reset("Position yourself in view.");

    try {
      await cameraRef.current?.startCamera();
    } catch {
      sessionQueue.endSession();
    }
  }

  function endSession() {
    cameraRef.current?.stopCamera();
  }

  function resetSession() {
    sessionQueue.resetSession();
    inferenceLoop.resetTrackingState();
    coachingBrain.reset();
    framingIntelligence.reset(
      sessionQueue.sessionStarted
        ? "Position yourself in view."
        : "Camera is off."
    );
  }

  function handleCameraReady(video: HTMLVideoElement) {
    const prescription = sessionQueue.getActivePrescription();
    if (!prescription) return;

    framingIntelligence.forcePreExerciseCheck(
      null,
      createEmptyFeatures(),
      prescription,
      Date.now()
    );

    inferenceLoop.startLoop(
      video,
      sessionQueue.getActivePrescription,
      handleExerciseComplete,
      coachingCallbacks,
      framingCallbacks,
      readinessEvaluator
    );
  }

  function handleCameraStop() {
    inferenceLoop.stopLoop();
    sessionQueue.endSession();
    framingIntelligence.reset("Camera is off.");
    coachingBrain.reset();
  }

  function toggleSessionSelection(sessionId: string) {
    if (
      sessionQueue.sessionStarted ||
      inferenceLoop.engineStatus === "loading" ||
      inferenceLoop.engineStatus === "running"
    )
      return;

    setSelectedSessionIds((current) => {
      if (current.includes(sessionId)) {
        const next = current.filter((id) => id !== sessionId);
        return next.length > 0 ? next : current;
      }
      return [...current, sessionId];
    });
  }

  // ============================================================
  // DERIVED UI VALUES
  // ============================================================

  const canBegin =
    combinedQueue.length > 0 &&
    inferenceLoop.engineStatus !== "running" &&
    inferenceLoop.engineStatus !== "loading";

  const currentPrescription = sessionQueue.currentPrescription;
  const currentQueueItem = sessionQueue.currentQueueItem;

  const instructionBody = currentPrescription
    ? `${getExerciseRequirement(currentPrescription.id)} Target: ${currentPrescription.repTarget} rep(s).${
        currentPrescription.hold.required
          ? ` Hold each rep for ${Math.round(currentPrescription.hold.durationMs / 1000)} second(s).`
          : ""
      }`
    : "Choose a session and begin when ready.";

  const { framingPanelState } = framingIntelligence;
  const { panelState: coachingPanelState } = coachingBrain;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "#d8e2ff", marginBottom: 6, fontSize: 14 }}>
        Movement Intelligence platform for physiotherapy.
      </div>

      <h1 style={{ marginTop: 0, marginBottom: 18, fontSize: 28, lineHeight: 1.2 }}>
        AI Physio BioMech Session Runner
      </h1>

      {/* ======================================================
          SESSION SELECTOR
      ====================================================== */}
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
                Select sessions, set patient profile, then begin.
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
              disabled={
                inferenceLoop.engineStatus !== "running" &&
                inferenceLoop.engineStatus !== "error"
              }
              style={{
                background: "#7cc6ff",
                color: "#08111f",
                fontWeight: 700,
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor:
                  inferenceLoop.engineStatus === "running" ||
                  inferenceLoop.engineStatus === "error"
                    ? "pointer"
                    : "not-allowed",
                opacity:
                  inferenceLoop.engineStatus === "running" ||
                  inferenceLoop.engineStatus === "error"
                    ? 1
                    : 0.5
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
              Reset
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
            {/* Session list */}
            <div style={{ display: "grid", gap: 12 }}>
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
                          background: checked
                            ? "rgba(124,198,255,0.12)"
                            : "#121933",
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
                          <div
                            style={{
                              fontSize: 13,
                              color: "#aab6d3",
                              marginTop: 4
                            }}
                          >
                            {session.exercises.length} exercise
                            {session.exercises.length === 1 ? "" : "s"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Patient profile selector */}
              <PatientProfileSelector
                profile={patientProfile}
                onChange={(updates) =>
                  setPatientProfile((prev) => ({ ...prev, ...updates }))
                }
                disabled={sessionQueue.sessionStarted}
              />
            </div>

            {/* Session preview */}
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
                  fontSize: 12,
                  color: "#7cc6ff",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginBottom: 14
                }}
              >
                Combined Plan Preview
              </div>

              {combinedQueue.length > 0 ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        color: "#d8e2ff",
                        marginBottom: 10,
                        lineHeight: 1.5
                      }}
                    >
                      {combinedGoal}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {[
                        formatDurationRange(combinedDurationSeconds),
                        `${combinedQueue.length} exercise${combinedQueue.length === 1 ? "" : "s"}`,
                        `${combinedTotalReps} total reps`
                      ].map((label) => (
                        <span
                          key={label}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            color: "white",
                            fontSize: 12
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {combinedQueue.map((item, index) => (
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
                          <div style={{ fontWeight: 600 }}>
                            {item.displayName}
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              color: "#aab6d3",
                              marginTop: 2
                            }}
                          >
                            {item.prescription.repTarget} reps
                            {item.prescription.hold.required
                              ? ` · ${item.prescription.hold.durationMs / 1000}s hold`
                              : ""}
                          </div>
                        </div>
                        <div
                          style={{
                            alignSelf: "center",
                            fontSize: 12,
                            color: "#aab6d3"
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

      {/* ======================================================
          MAIN CONTENT — CAMERA + PANELS
      ====================================================== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          alignItems: "start"
        }}
      >
        {/* CAMERA PANEL */}
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
              {formatPhase(inferenceLoop.phase)}
            </div>
          </div>

          <div style={{ width: "100%", maxWidth: 720 }}>
            {/* Framing banner — now driven by framing intelligence */}
            <div
              style={{
                marginBottom: 10,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background:
                  framingPanelState.tone === "good"
                    ? "rgba(100,220,150,0.15)"
                    : framingPanelState.tone === "critical"
                    ? "rgba(255,100,100,0.15)"
                    : "rgba(255,180,80,0.15)",
                color:
                  framingPanelState.tone === "good"
                    ? "#9be7b0"
                    : framingPanelState.tone === "critical"
                    ? "#ff8f8f"
                    : "#ffcc80",
                border:
                  framingPanelState.tone === "good"
                    ? "1px solid rgba(100,220,150,0.4)"
                    : framingPanelState.tone === "critical"
                    ? "1px solid rgba(255,100,100,0.4)"
                    : "1px solid rgba(255,180,80,0.4)",
                display: "flex",
                alignItems: "center",
                gap: 8
              }}
            >
              {framingPanelState.evaluating && (
                <span style={{ opacity: 0.6, fontSize: 11 }}>●</span>
              )}
              {framingPanelState.exercisePaused && (
                <span style={{ fontSize: 11 }}>⏸</span>
              )}
              {framingPanelState.message}
            </div>

            <div style={{ position: "relative", width: "100%" }}>
              <CameraViewport
                ref={cameraRef}
                onVideoReady={handleCameraReady}
                onCameraStop={handleCameraStop}
                showStartButton={false}
              />
              <div
                style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
              >
                <PoseCanvasOverlay frame={inferenceLoop.frame} />
              </div>
            </div>
          </div>

          {inferenceLoop.engineError && (
            <p style={{ color: "#ff8f8f", marginBottom: 0, marginTop: 12 }}>
              {inferenceLoop.engineError}
            </p>
          )}
        </section>

        {/* RIGHT COLUMN — INSTRUCTION + COACHING + OBSERVATION */}
        <section style={{ display: "grid", gap: 16 }}>

          {/* LIVE COACHING PANEL */}
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
                  {formatPhase(inferenceLoop.phase)}
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
                  {currentPrescription?.repTarget
                    ? `Rep ${inferenceLoop.repCount}/${currentPrescription.repTarget}`
                    : "Rep 0/0"}
                </span>
                {inferenceLoop.holdRemainingMs !== null &&
                  inferenceLoop.phase === "holding" && (
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
                      Hold{" "}
                      {Math.max(
                        1,
                        Math.ceil(inferenceLoop.holdRemainingMs / 1000)
                      )}
                      s
                    </span>
                  )}
              </div>
            </div>

            {/* Static instruction block */}
            <div
              style={{
                background: "#101833",
                borderRadius: 12,
                padding: 20,
                minHeight: 120,
                border: "1px solid rgba(255,255,255,0.06)",
                marginBottom: 12
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  lineHeight: 1.15,
                  marginBottom: 12
                }}
              >
                {currentQueueItem?.displayName ?? "No active exercise"}
              </div>

              <div
                style={{
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: "#e6ecff",
                  marginBottom: 12
                }}
              >
                {instructionBody}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 6,
                  color: "#c7d3f5",
                  fontSize: 14
                }}
              >
                <div>
                  <strong>Position:</strong>{" "}
                  {getPositionRequirement(currentPrescription?.id)}
                </div>
                <div>
                  <strong>Progress:</strong> {sessionQueue.overallProgressLabel}
                </div>
                <div>
                  <strong>Session:</strong>{" "}
                  {sessionQueue.sessionComplete
                    ? "Complete"
                    : sessionQueue.sessionStarted
                    ? "In progress"
                    : "Not started"}
                </div>
              </div>
            </div>

            {/* AI Coaching message block */}
            <div
              style={{
                background: "#101833",
                borderRadius: 12,
                padding: 16,
                minHeight: 60,
                border: `1px solid ${
                  coachingPanelState.tone === "corrective"
                    ? "rgba(255,180,80,0.3)"
                    : coachingPanelState.tone === "urgent"
                    ? "rgba(255,100,100,0.3)"
                    : coachingPanelState.tone === "encouraging"
                    ? "rgba(100,220,150,0.3)"
                    : "rgba(255,255,255,0.06)"
                }`,
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              {coachingPanelState.isThinking ? (
                <div style={{ color: "#7a88a8", fontSize: 14, fontStyle: "italic" }}>
                  …
                </div>
              ) : coachingPanelState.message ? (
                <>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background:
                        coachingPanelState.tone === "corrective"
                          ? "#ffcc80"
                          : coachingPanelState.tone === "urgent"
                          ? "#ff8f8f"
                          : coachingPanelState.tone === "encouraging"
                          ? "#9be7b0"
                          : "#7cc6ff"
                    }}
                  />
                  <div
                    style={{
                      fontSize: 16,
                      lineHeight: 1.5,
                      color:
                        coachingPanelState.tone === "corrective"
                          ? "#ffcc80"
                          : coachingPanelState.tone === "urgent"
                          ? "#ff8f8f"
                          : coachingPanelState.tone === "encouraging"
                          ? "#9be7b0"
                          : "#e6ecff",
                      fontWeight: 500
                    }}
                  >
                    {coachingPanelState.message}
                  </div>
                  {coachingPanelState.source === "fallback" && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "#7a88a8",
                        marginLeft: "auto",
                        flexShrink: 0
                      }}
                    >
                      fallback
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: "#7a88a8", fontSize: 14 }}>
                  {sessionQueue.sessionStarted
                    ? "Watching your movement…"
                    : "Coaching will appear here during the session."}
                </div>
              )}
            </div>
          </div>

          {/* CAMERA UNDERSTANDING PANEL */}
          <div
            style={{
              background: "#1a2040",
              padding: 20,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)"
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>
              What the camera sees
            </h3>

            <div
              style={{
                background: "#101833",
                borderRadius: 12,
                padding: 16,
                border: "1px solid rgba(255,255,255,0.06)",
                marginBottom: 14
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                Visibility
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {inferenceLoop.liveObservation.visibilityLines.map(
                  (line, index) => (
                    <div
                      key={`vis-${index}`}
                      style={{ color: "#d8e2ff", lineHeight: 1.45, fontSize: 13 }}
                    >
                      • {line}
                    </div>
                  )
                )}
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
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                Movement status
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {inferenceLoop.liveObservation.movementLines.map(
                  (line, index) => (
                    <div
                      key={`move-${index}`}
                      style={{ color: "#d8e2ff", lineHeight: 1.45, fontSize: 13 }}
                    >
                      • {line}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ======================================================
          SESSION STATUS BAR
      ====================================================== */}
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
          <h3 style={{ margin: 0 }}>Session Status</h3>
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
            {statusCollapsed ? "Expand" : "Collapse"}
          </button>
        </div>

        {!statusCollapsed && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: 14,
              fontSize: 14
            }}
          >
            {[
              {
                label: "Current exercise",
                value: currentQueueItem?.displayName ?? "None"
              },
              {
                label: "Progress",
                value: sessionQueue.overallProgressLabel
              },
              {
                label: "Camera",
                value: inferenceLoop.engineStatus
              },
              {
                label: "Framing",
                value: framingPanelState.severity
              },
              {
                label: "Patient type",
                value: patientProfile.type.replace("_", " ")
              }
            ].map(({ label, value }) => (
              <div key={label}>
                {label}:
                <div style={{ fontWeight: 700, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      
    </div>
  );
}
