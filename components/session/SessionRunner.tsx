"use client";

// ============================================================
// components/session/SessionRunner.tsx
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
import MovementTimelinePanel from "@/components/debug/MovementTimelinePanel";
import {
  recordSnapshot,
  recordRepCompleted,
  recordRepFailed,
  recordHoldStarted,
  recordMessage,
  recordExerciseStart,
  recordExerciseComplete
} from "@/lib/debug/movementTimeline";

// ============================================================
// DEBUG LOG
// ============================================================

type LogLevel = "info" | "success" | "warning" | "error" | "api_out" | "api_in";

type DebugLogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  detail?: string;
};

let globalDebugLog: DebugLogEntry[] = [];
let globalSetDebugLog: React.Dispatch<React.SetStateAction<DebugLogEntry[]>> | null = null;

function writeDebugLog(level: LogLevel, category: string, message: string, detail?: string) {
  const entry: DebugLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toLocaleTimeString("en-CA", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2
    }),
    level, category, message, detail
  };
  globalDebugLog = [entry, ...globalDebugLog].slice(0, 50);
  if (globalSetDebugLog) globalSetDebugLog([...globalDebugLog]);
}

let fetchPatched = false;

function patchFetch() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/coach")) {
      let promptSnippet = "";
      try {
        const body = JSON.parse((init?.body as string) ?? "{}");
        promptSnippet = (body.prompt ?? "").slice(0, 200);
      } catch { promptSnippet = "(could not parse)"; }
      writeDebugLog("api_out", "API", "POST /api/coach →", promptSnippet + (promptSnippet.length >= 200 ? "…" : ""));
      try {
        const response = await originalFetch(input, init);
        const cloned = response.clone();
        cloned.json().then((data) => {
          if (data.error) {
            writeDebugLog("error", "API", `Error: ${data.error}`, data.detail ?? "");
          } else {
            const text = (data.text ?? "").slice(0, 300);
            writeDebugLog("api_in", "API", "← Response received", text);
          }
        }).catch(() => writeDebugLog("error", "API", "Could not parse response"));
        return response;
      } catch (error) {
        writeDebugLog("error", "API", "Fetch failed", error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    return originalFetch(input, init);
  };
}

// Copy text to clipboard helper
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // fallback
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  });
}

// ============================================================
// SESSION TIMER HOOK
// ============================================================

function useSessionTimer(running: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      startTimeRef.current = Date.now() - elapsedMs;
      const tick = () => {
        if (startTimeRef.current !== null) {
          setElapsedMs(Date.now() - startTimeRef.current);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [running]);

  // Reset when session stops
  useEffect(() => {
    if (!running) {
      setElapsedMs(0);
      startTimeRef.current = null;
    }
  }, [running]);

  const formatted = useMemo(() => {
    const totalSec = Math.floor(elapsedMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [elapsedMs]);

  return formatted;
}

// ============================================================
// HELPERS
// ============================================================

function formatPhase(phase: string): string {
  const labels: Record<string, string> = {
    lifting: "Lift", holding: "Hold", lowering: "Lower", ready: "Ready", complete: "Complete"
  };
  return labels[phase] ?? "Tracking";
}

function getExerciseRequirement(id: string | undefined): string {
  switch (id) {
    case "right-arm-raise": return "Lift your right arm to shoulder height, hold, then lower slowly.";
    case "left-arm-raise": return "Lift your left arm to shoulder height, hold, then lower slowly.";
    case "both-arm-raise": return "Lift both arms evenly to shoulder height, hold, then lower slowly.";
    case "sit-to-stand": return "Stand up fully, hold briefly, then lower back to the seat slowly.";
    default: return "Perform the exercise with slow, controlled movement.";
  }
}

function getPositionRequirement(id: string | undefined): string {
  switch (id) {
    case "sit-to-stand": return "Start seated, then stand fully and return to seated.";
    case "right-arm-raise":
    case "left-arm-raise":
    case "both-arm-raise": return "Remain upright. Seated or standing is acceptable.";
    default: return "Remain upright and centered in view.";
  }
}

const LOG_COLORS: Record<LogLevel, { bg: string; color: string; label: string }> = {
  info:    { bg: "rgba(124,198,255,0.08)", color: "#7cc6ff", label: "INFO" },
  success: { bg: "rgba(100,220,150,0.08)", color: "#9be7b0", label: "OK" },
  warning: { bg: "rgba(255,200,80,0.08)",  color: "#ffcc80", label: "WARN" },
  error:   { bg: "rgba(255,100,100,0.08)", color: "#ff8f8f", label: "ERR" },
  api_out: { bg: "rgba(180,130,255,0.08)", color: "#c4a0ff", label: "OUT" },
  api_in:  { bg: "rgba(100,220,200,0.08)", color: "#6ee7d4", label: "IN" }
};

// ============================================================
// SESSION RUNNER
// ============================================================

interface SessionRunnerProps {
  prescriptionQueue?: import("@/lib/types/exercise").ExercisePrescription[];
  sessionTitle?: string;
  initialPatientProfile?: import("@/lib/patient/patientTypes").PatientProfile;
}

export default function SessionRunner({ prescriptionQueue, sessionTitle, initialPatientProfile }: SessionRunnerProps = {}) {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;
  const cameraRef = useRef<CameraViewportHandle | null>(null);

  useEffect(() => { patchFetch(); }, []);

  // Voice toggle
  const [voiceOn, setVoiceOn] = useState(true);
  const handleVoiceToggle = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    coachingBrain.setVoiceEnabled(next);
  };

  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [aiEngineStatus, setAiEngineStatus] = useState<"untested" | "ok" | "error" | "checking">("untested");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile>(
  initialPatientProfile ?? createDefaultPatientProfile()
);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [voiceEnabled, setVoiceEnabledState] = useState(true);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);

  useEffect(() => {
    globalSetDebugLog = setDebugLog;
    return () => { globalSetDebugLog = null; };
  }, []);

  const sessionQueue = useSessionQueue();
  const inferenceLoop = useInferenceLoop();
  const framingIntelligence = useFramingIntelligence(patientProfile);
  const coachingBrain = useCoachingBrain();
  const patientContext = usePatientContext(patientProfile);

  // Keep patientContext profile in sync when user changes patient type
  useEffect(() => {
    patientContext.updatePatientProfile(patientProfile);
  }, [patientProfile]);

  // Session timer — runs while engine is running
  const sessionTimer = useSessionTimer(inferenceLoop.engineStatus === "running");

  useEffect(() => {
    if (selectedSessionIds.length === 0 && sessions[0]) {
      setSelectedSessionIds([sessions[0].id]);
    }
  }, [sessions, selectedSessionIds.length]);

  // ============================================================
  // API TEST
  // ============================================================

  async function checkAiEngine(silent = false) {
    if (!silent) writeDebugLog("info", "API", "Testing AI engine…");
    setAiEngineStatus("checking");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: 'Reply with this exact JSON: {"status":"ok"}',
          system: "You are a test endpoint. Always respond with valid JSON only."
        })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (!silent) writeDebugLog("error", "API", "AI engine error: HTTP " + response.status, errData.error ?? "");
        setAiEngineStatus("error");
        return false;
      }
      const data = await response.json();
      if (data.text) {
        if (!silent) writeDebugLog("success", "API", "AI engine connected ✓");
        setAiEngineStatus("ok");
        return true;
      } else {
        if (!silent) writeDebugLog("error", "API", "Unexpected response", JSON.stringify(data).slice(0, 100));
        setAiEngineStatus("error");
        return false;
      }
    } catch (error) {
      if (!silent) writeDebugLog("error", "API", "AI engine unreachable", error instanceof Error ? error.message : String(error));
      setAiEngineStatus("error");
      return false;
    }
  }

  // ============================================================
  // QUEUE PREVIEW
  // ============================================================

  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedSessionIds.includes(s.id)),
    [sessions, selectedSessionIds]
  );

 const combinedQueue = useMemo(() => {
  if (prescriptionQueue && prescriptionQueue.length > 0) {
    return prescriptionQueue.map((p) => ({
      id: p.id,
      displayName: p.name,
      prescription: p,
      seconds: p.repTarget * ((p.hold?.durationMs ?? 2000) / 1000 + 5),
      sessionName: sessionTitle ?? "Session",
    }));
  }
  return buildQueueFromSessions(selectedSessions, exercises);
}, [selectedSessions, exercises, prescriptionQueue, sessionTitle]);

  const combinedGoal = useMemo(
    () => inferSessionGoal(combinedQueue.map((i) => i.id)),
    [combinedQueue]
  );

  const combinedTotalReps = useMemo(
    () => combinedQueue.reduce((s, i) => s + i.prescription.repTarget, 0),
    [combinedQueue]
  );

  const combinedDurationSeconds = useMemo(
    () => combinedQueue.reduce((s, i) => s + i.seconds, 0),
    [combinedQueue]
  );

  // ============================================================
  // CALLBACKS
  // ============================================================

  const readinessEvaluator = useCallback((frame: any, features: any, prescription: any) => {
    const r = evaluateReadiness({ frame, features, prescription, averageBrightness: null });
    return { ready: r.ready, message: r.message };
  }, []);

  const coachingCallbacks = useMemo(() => ({
    onRepCompleted: (nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      writeDebugLog("info", "COACHING", "Rep completed event fired", "prescription=" + (prescription?.id ?? "null") + " ctx=" + (exerciseCtx ? "ok" : "null") + " repCount=" + (exerciseCtx?.repCount ?? "?"));
      if (!prescription || !exerciseCtx) { writeDebugLog("error", "COACHING", "onRepCompleted BLOCKED — null ctx or prescription"); return; }
      recordRepCompleted(exerciseCtx.repCount, nowMs);
      patientContext.recordRepOutcome("success", null, null);
      writeDebugLog("info", "COACHING", "Calling coachingBrain.onRepCompleted");
      coachingBrain.onRepCompleted({ prescription, patientProfile, exerciseContext: exerciseCtx, nowMs });
    },
    onRepFailed: (failureReason: string, nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      writeDebugLog("warning", "COACHING", "Rep failed: " + failureReason, "ctx=" + (exerciseCtx ? "ok" : "null"));
      if (!prescription || !exerciseCtx) return;
      recordRepFailed(failureReason, exerciseCtx.repCount, nowMs);
      patientContext.recordRepOutcome("failed", failureReason, null);
      coachingBrain.onRepFailed({ prescription, patientProfile, exerciseContext: exerciseCtx, failureReason, nowMs });
    },
    onHoldStarted: (holdRequiredMs: number, nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      writeDebugLog("info", "COACHING", "Hold started (" + holdRequiredMs + "ms)");
      if (!prescription || !exerciseCtx) return;
      recordHoldStarted(holdRequiredMs, nowMs);
      coachingBrain.onHoldStarted({ prescription, patientProfile, exerciseContext: exerciseCtx, holdRequiredMs, nowMs });
    },
    onExerciseStarted: (nowMs: number) => {
      const prescription = sessionQueue.getActivePrescription();
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      writeDebugLog("info", "COACHING", "Exercise started: " + (prescription?.name ?? "unknown"), "ctx=" + (exerciseCtx ? "ok" : "null") + " prescription=" + (prescription?.id ?? "null"));
      if (!prescription) { writeDebugLog("error", "COACHING", "onExerciseStarted — prescription is null"); return; }
      if (!exerciseCtx) {
        writeDebugLog("warning", "COACHING", "onExerciseStarted — ctx null, retrying in 300ms");
        // Retry once after a short delay to allow React state to settle
        window.setTimeout(() => {
          const retryCtx = patientContext.getCurrentExerciseContext();
          const retryPrescription = sessionQueue.getActivePrescription();
          writeDebugLog("info", "COACHING", "onExerciseStarted retry: ctx=" + (retryCtx ? "ok" : "still null"));
          if (retryCtx && retryPrescription) {
            coachingBrain.onExerciseStarted({ prescription: retryPrescription, patientProfile, exerciseContext: retryCtx, nowMs: Date.now() });
          }
        }, 300);
        return;
      }
      coachingBrain.onExerciseStarted({ prescription, patientProfile, exerciseContext: exerciseCtx, nowMs });
    },
          feedFrame: (params: { phase: string; repCount: number; holdElapsedMs: number | null; holdRequiredMs: number | null; primaryIssue: string; armElevation?: number | null; nowMs: number; }) => {
      const prescription = sessionQueue.getActivePrescription();
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      if (!prescription || !exerciseCtx) return;
      recordSnapshot({
        nowMs: params.nowMs,
        phase: params.phase,
        repCount: params.repCount,
        repTarget: prescription.repTarget,
        activeMetricValue: params.armElevation ?? null,
        holdElapsedMs: params.holdElapsedMs,
        holdRequiredMs: params.holdRequiredMs,
        primaryIssue: params.primaryIssue
      });
      coachingBrain.feedFrame({ ...params, prescription, patientProfile, exerciseContext: exerciseCtx });
    }
  }), [sessionQueue, patientProfile, patientContext, coachingBrain]);

  // Keep a stable ref to coachingCallbacks so the inference loop
  // always calls the latest version — avoids stale closure bug
  const coachingCallbacksRef = useRef(coachingCallbacks);
  useEffect(() => {
    coachingCallbacksRef.current = coachingCallbacks;
  }, [coachingCallbacks]);

  const stableCoachingCallbacks = useRef({
    onRepCompleted: (nowMs: number) => coachingCallbacksRef.current.onRepCompleted(nowMs),
    onRepFailed: (reason: string, nowMs: number) => coachingCallbacksRef.current.onRepFailed(reason, nowMs),
    onHoldStarted: (ms: number, nowMs: number) => coachingCallbacksRef.current.onHoldStarted(ms, nowMs),
    onExerciseStarted: (nowMs: number) => coachingCallbacksRef.current.onExerciseStarted(nowMs),
    feedFrame: (params: any) => coachingCallbacksRef.current.feedFrame(params),
  }).current;

  const framingCallbacks = useMemo(() => ({
    evaluateFraming: framingIntelligence.evaluateFraming
  }), [framingIntelligence.evaluateFraming]);

  // ============================================================
  // EXERCISE COMPLETE
  // ============================================================

  const handleExerciseComplete = useCallback(() => {
    const prescription = sessionQueue.getActivePrescription();
    const exerciseCtx = patientContext.getCurrentExerciseContext();
    writeDebugLog("success", "SESSION", `Exercise complete: ${prescription?.name ?? "?"}`);
    if (prescription && exerciseCtx) {
      coachingBrain.onExerciseCompleting({ prescription, patientProfile, exerciseContext: exerciseCtx, nowMs: Date.now() });
    }
    patientContext.completeExercise();
    sessionQueue.advanceQueue(
      (nextItem: QueueItem, nextIndex: number) => {
        writeDebugLog("info", "SESSION", "Advancing to: " + nextItem.displayName);
        inferenceLoop.resetTrackingState();
        framingIntelligence.reset("Position yourself for the next exercise.");
        patientContext.beginExercise(nextItem.prescription, nextIndex, sessionQueue.getActiveQueue().length);
        framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), nextItem.prescription, Date.now());
        // Fire exercise started coaching for the new exercise
        // Wait for exercise_completing speech to finish if it's still speaking
        // This prevents the next exercise intro from cutting off the completion summary
        const waitForSpeech = () => {
          if (window.speechSynthesis?.speaking) {
            window.setTimeout(waitForSpeech, 300);
          } else {
            // Add a brief natural pause after speech ends
            window.setTimeout(() => {
              stableCoachingCallbacks.onExerciseStarted(Date.now());
            }, 600);
          }
        };
        // Start checking after a minimum delay for state to settle
        window.setTimeout(waitForSpeech, 300);
      },
      () => { writeDebugLog("success", "SESSION", "All exercises complete"); }
    );
  }, [sessionQueue, patientContext, coachingBrain, patientProfile, inferenceLoop, framingIntelligence]);

  // ============================================================
  // SESSION LIFECYCLE
  // ============================================================

  async function beginCombinedSession() {
    if (combinedQueue.length === 0) return;
    writeDebugLog("info", "SESSION", `Beginning — ${combinedQueue.length} exercise(s), patient: ${patientProfile.type}`);
    // Auto-check AI engine on session start
    checkAiEngine(true);

    const started = sessionQueue.beginSession(combinedQueue);
    if (!started) { writeDebugLog("error", "SESSION", "beginSession returned false"); return; }
    setSelectorCollapsed(true);
    patientContext.beginSession();
    writeDebugLog("info", "SESSION", `beginExercise: ${combinedQueue[0].prescription.name}`);
    patientContext.beginExercise(combinedQueue[0].prescription, 0, combinedQueue.length);
    framingIntelligence.reset("Position yourself in view.");
    try {
      await cameraRef.current?.startCamera();
    } catch (error) {
      writeDebugLog("error", "SESSION", "Camera failed", String(error));
      sessionQueue.endSession();
    }
  }

  function handleCameraReady(video: HTMLVideoElement) {
    const prescription = sessionQueue.getActivePrescription();
    writeDebugLog("info", "CAMERA", "Camera ready", `prescription=${prescription?.id ?? "null"}`);
    if (!prescription) { writeDebugLog("error", "CAMERA", "No active prescription"); return; }
    framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), prescription, Date.now());
    inferenceLoop.startLoop(video, sessionQueue.getActivePrescription, handleExerciseComplete, stableCoachingCallbacks, framingCallbacks, readinessEvaluator);
  }

  function handleCameraStop() {
    writeDebugLog("info", "CAMERA", "Camera stopped");
    inferenceLoop.stopLoop();
    sessionQueue.endSession();
    framingIntelligence.reset("Camera is off.");
    coachingBrain.reset();
  }

  function endSession() { cameraRef.current?.stopCamera(); }

  function resetSession() {
    sessionQueue.resetSession();
    inferenceLoop.resetTrackingState();
    coachingBrain.reset();
    framingIntelligence.reset(sessionQueue.sessionStarted ? "Position yourself in view." : "Camera is off.");
    writeDebugLog("info", "SESSION", "Reset");
  }

  function toggleSessionSelection(sessionId: string) {
    if (sessionQueue.sessionStarted || inferenceLoop.engineStatus === "loading" || inferenceLoop.engineStatus === "running") return;
    setSelectedSessionIds((current) => {
      if (current.includes(sessionId)) {
        const next = current.filter((id) => id !== sessionId);
        return next.length > 0 ? next : current;
      }
      return [...current, sessionId];
    });
  }

  // ============================================================
  // DERIVED
  // ============================================================

  const canBegin = combinedQueue.length > 0 && inferenceLoop.engineStatus !== "running" && inferenceLoop.engineStatus !== "loading";
  const currentPrescription = sessionQueue.currentPrescription;
  const currentQueueItem = sessionQueue.currentQueueItem;
  const { framingPanelState } = framingIntelligence;
  const { panelState: coachingPanelState } = coachingBrain;

    const holdLine = currentPrescription?.hold.required
    ? " Hold each rep for " + Math.round((currentPrescription.hold.durationMs ?? 0) / 1000) + "s."
    : "";
  const instructionBody = currentPrescription
    ? getExerciseRequirement(currentPrescription.id) + " Target: " + currentPrescription.repTarget + " rep(s)." + holdLine
    : "Choose a session and begin when ready.";

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div style={{ marginTop: 12, fontFamily: "system-ui, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
            AI Physio BioMech
          </h1>
          <div style={{ fontSize: 12, color: "#7a88a8", marginTop: 2 }}>
            Movement Intelligence Platform
          </div>
        </div>

        {/* SESSION TIMER */}
        {inferenceLoop.engineStatus === "running" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(124,198,255,0.08)",
            border: "1px solid rgba(124,198,255,0.2)",
            borderRadius: 10, padding: "8px 16px"
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#9be7b0", boxShadow: "0 0 6px #9be7b0", animation: "pulse 2s infinite" }} />
            <div>
              <div style={{ fontSize: 11, color: "#7a88a8", textTransform: "uppercase", letterSpacing: 0.8 }}>Session Time</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "white", letterSpacing: 2 }}>
                {sessionTimer}
              </div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(255,255,255,0.08)", paddingLeft: 12 }}>
              <div style={{ fontSize: 11, color: "#7a88a8", textTransform: "uppercase", letterSpacing: 0.8 }}>Exercise</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>
                {currentQueueItem
                  ? `${sessionQueue.queueIndex + 1} / ${sessionQueue.getActiveQueue().length}`
                  : "—"}
              </div>
            </div>
          </div>
        )}

        {/* API STATUS */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: aiEngineStatus === "ok" ? "#9be7b0" : aiEngineStatus === "error" ? "#ff8f8f" : aiEngineStatus === "checking" ? "#ffcc80" : "#7a88a8",
              boxShadow: aiEngineStatus === "ok" ? "0 0 6px #9be7b0" : aiEngineStatus === "checking" ? "0 0 6px #ffcc80" : "none",
              animation: aiEngineStatus === "checking" ? "pulse 1s infinite" : "none"
            }} />
            <span style={{ fontSize: 12, color: aiEngineStatus === "ok" ? "#9be7b0" : aiEngineStatus === "error" ? "#ff8f8f" : "#7a88a8" }}>
              {aiEngineStatus === "ok" ? "AI Engine Ready" : aiEngineStatus === "error" ? "AI Engine Error" : aiEngineStatus === "checking" ? "Connecting…" : "AI Engine"}
            </span>
          </div>
          <button
            onClick={handleVoiceToggle}
            style={{
              background: voiceOn ? "rgba(100,220,150,0.12)" : "rgba(255,255,255,0.06)",
              color: voiceOn ? "#9be7b0" : "#7a88a8",
              border: "1px solid " + (voiceOn ? "rgba(100,220,150,0.3)" : "rgba(255,255,255,0.1)"),
              borderRadius: 7, padding: "5px 12px",
              fontSize: 11, fontWeight: 700, cursor: "pointer"
            }}
          >
            {voiceOn ? "🔊 Voice" : "🔇 Muted"}
          </button>
          <button onClick={() => checkAiEngine(false)} style={{
            background: "rgba(124,198,255,0.1)", color: "#7cc6ff",
            border: "1px solid rgba(124,198,255,0.25)", borderRadius: 7,
            padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer"
          }}>
            Test
          </button>
        </div>
      </div>

      {/* ── MAIN GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginBottom: 16 }}>

        {/* CAMERA */}
        <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{
            marginBottom: 10, padding: "8px 12px", borderRadius: 8,
            fontSize: 13, fontWeight: 600,
            background: framingPanelState.tone === "good" ? "rgba(100,220,150,0.12)" : framingPanelState.tone === "critical" ? "rgba(255,100,100,0.12)" : "rgba(255,180,80,0.12)",
            color: framingPanelState.tone === "good" ? "#9be7b0" : framingPanelState.tone === "critical" ? "#ff8f8f" : "#ffcc80",
            border: `1px solid ${framingPanelState.tone === "good" ? "rgba(100,220,150,0.3)" : framingPanelState.tone === "critical" ? "rgba(255,100,100,0.3)" : "rgba(255,180,80,0.3)"}`,
            display: "flex", alignItems: "center", gap: 8
          }}>
            {framingPanelState.evaluating && <span style={{ fontSize: 10, opacity: 0.6 }}>●</span>}
            {framingPanelState.message}
            <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.4 }}>[{framingPanelState.severity}]</span>
          </div>

          <div style={{ position: "relative" }}>
            <CameraViewport ref={cameraRef} onVideoReady={handleCameraReady} onCameraStop={handleCameraStop} showStartButton={false} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <PoseCanvasOverlay frame={inferenceLoop.frame} />
            </div>
          </div>

          {inferenceLoop.engineError && (
            <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(255,100,100,0.1)", color: "#ff8f8f", fontSize: 13 }}>
              {inferenceLoop.engineError}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 12 }}>

          {/* COACHING PANEL */}
          <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Live Coaching</div>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(124,198,255,0.12)", color: "#7cc6ff", fontSize: 11, fontWeight: 700 }}>
                  {formatPhase(inferenceLoop.phase)}
                </span>
                <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "white", fontSize: 11, fontWeight: 700 }}>
                  {inferenceLoop.repCount}/{currentPrescription?.repTarget ?? 0}
                </span>
                {inferenceLoop.holdRemainingMs !== null && inferenceLoop.phase === "holding" && (
                  <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(100,220,150,0.12)", color: "#9be7b0", fontSize: 11, fontWeight: 700 }}>
                    Hold {Math.max(1, Math.ceil(inferenceLoop.holdRemainingMs / 1000))}s
                  </span>
                )}
              </div>
            </div>

            {/* Exercise title + instructions */}
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, lineHeight: 1.2 }}>
              {currentQueueItem?.displayName ?? "No active exercise"}
            </div>
            <div style={{ fontSize: 13, color: "#aab6d3", marginBottom: 12, lineHeight: 1.5 }}>
              {instructionBody}
            </div>
            <div style={{ fontSize: 12, color: "#7a88a8", marginBottom: 12 }}>
              <strong style={{ color: "#c7d3f5" }}>Position:</strong> {getPositionRequirement(currentPrescription?.id)}
            </div>

            {/* AI coaching message */}
            <div style={{
              background: "#0d1526", borderRadius: 10, padding: 14, minHeight: 52,
              border: `1px solid ${
                coachingPanelState.tone === "corrective" ? "rgba(255,200,80,0.25)" :
                coachingPanelState.tone === "urgent" ? "rgba(255,100,100,0.25)" :
                coachingPanelState.tone === "encouraging" ? "rgba(100,220,150,0.25)" :
                "rgba(255,255,255,0.06)"
              }`,
              display: "flex", alignItems: "center", gap: 10
            }}>
              {coachingPanelState.isThinking ? (
                <div style={{ color: "#7a88a8", fontSize: 13, fontStyle: "italic" }}>Thinking…</div>
              ) : coachingPanelState.message ? (
                <>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: coachingPanelState.tone === "corrective" ? "#ffcc80" :
                      coachingPanelState.tone === "urgent" ? "#ff8f8f" :
                      coachingPanelState.tone === "encouraging" ? "#9be7b0" : "#7cc6ff"
                  }} />
                  <div style={{ fontSize: 15, color: "white", fontWeight: 500, lineHeight: 1.4, flex: 1 }}>
                    {coachingPanelState.message}
                  </div>
                  <div style={{ fontSize: 10, color: "#7a88a8", flexShrink: 0 }}>
                    {coachingPanelState.source}
                  </div>
                </>
              ) : (
                <div style={{ color: "#7a88a8", fontSize: 13 }}>
                  {sessionQueue.sessionStarted ? "Watching your movement…" : "Start a session to begin coaching."}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: "#7a88a8" }}>
              Patient: <strong style={{ color: "white" }}>{patientProfile.type.replace("_", " ")}</strong>
              {" · "}Session #{patientProfile.sessionNumber}
            </div>
          </div>

          {/* CAMERA SEES */}
          <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 10 }}>Camera Sees</div>
            <div style={{ display: "grid", gap: 3 }}>
              {inferenceLoop.liveObservation.visibilityLines.slice(0, 4).map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: "#aab6d3" }}>• {line}</div>
              ))}
              {inferenceLoop.liveObservation.movementLines.slice(0, 4).map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: "#d8e2ff" }}>• {line}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── SESSION SELECTOR ── */}
      <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: selectorCollapsed ? 0 : 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Session Selector</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={beginCombinedSession} disabled={!canBegin} style={{
              background: canBegin ? "#9be7b0" : "rgba(155,231,176,0.2)", color: canBegin ? "#08111f" : "#7a88a8",
              fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "none", cursor: canBegin ? "pointer" : "not-allowed", fontSize: 13
            }}>Begin Session</button>
            <button onClick={endSession} disabled={inferenceLoop.engineStatus !== "running"} style={{
              background: "rgba(124,198,255,0.1)", color: "#7cc6ff", padding: "7px 14px",
              borderRadius: 8, border: "1px solid rgba(124,198,255,0.2)", cursor: "pointer", fontSize: 13
            }}>End</button>
            <button onClick={resetSession} style={{
              background: "rgba(255,255,255,0.06)", color: "#aab6d3", padding: "7px 14px",
              borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13
            }}>Reset</button>
            <button onClick={() => setSelectorCollapsed(v => !v)} style={{
              background: "rgba(255,255,255,0.06)", color: "#7a88a8", padding: "7px 12px",
              borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13
            }}>{selectorCollapsed ? "▼" : "▲"}</button>
          </div>
        </div>

        {!selectorCollapsed && (
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 11, color: "#7a88a8", textTransform: "uppercase", letterSpacing: 0.6 }}>Sessions</div>
              {sessions.map((session) => {
                const checked = selectedSessionIds.includes(session.id);
                return (
                  <label key={session.id} style={{
                    display: "flex", gap: 8, alignItems: "flex-start",
                    padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    background: checked ? "rgba(124,198,255,0.08)" : "#121933",
                    border: `1px solid ${checked ? "rgba(124,198,255,0.3)" : "rgba(255,255,255,0.06)"}`
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSessionSelection(session.id)} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{session.name}</div>
                      <div style={{ fontSize: 11, color: "#7a88a8", marginTop: 2 }}>{session.exercises.length} exercises</div>
                    </div>
                  </label>
                );
              })}
              <PatientProfileSelector
                profile={patientProfile}
                onChange={(updates) => setPatientProfile(prev => ({ ...prev, ...updates }))}
                disabled={sessionQueue.sessionStarted}
              />
            </div>

            <div style={{ background: "#121933", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#7a88a8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 }}>Plan Preview</div>
              {combinedQueue.length > 0 ? (
                <>
                  <div style={{ color: "#d8e2ff", fontSize: 13, marginBottom: 10 }}>{combinedGoal}</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                    {[formatDurationRange(combinedDurationSeconds), `${combinedQueue.length} exercises`, `${combinedTotalReps} reps`].map(label => (
                      <span key={label} style={{ padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "#aab6d3", fontSize: 11 }}>{label}</span>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {combinedQueue.map((item, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>{item.displayName}</span>
                        <span style={{ color: "#7a88a8" }}>{item.prescription.repTarget} reps{item.prescription.hold.required ? ` · ${item.prescription.hold.durationMs / 1000}s hold` : ""}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ color: "#7a88a8", fontSize: 13 }}>Select sessions above to preview.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── DEBUG LOG ── */}
      <div style={{ background: "#0a0f1e", borderRadius: 12, border: "1px solid rgba(124,198,255,0.15)", overflow: "hidden" }}>
        <div
          onClick={() => setDebugOpen(v => !v)}
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 16px", background: "rgba(124,198,255,0.04)",
            borderBottom: debugOpen ? "1px solid rgba(124,198,255,0.1)" : "none",
            cursor: "pointer"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8 }}>Debug Log</span>
            <span style={{ fontSize: 11, color: "#7a88a8" }}>{debugLog.length} entries</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const snapshot = [
                  "=== AI PHYSIO DEBUG SNAPSHOT ===",
                  "Time: " + new Date().toISOString(),
                  "Engine: " + inferenceLoop.engineStatus,
                  "Phase: " + inferenceLoop.phase,
                  "RepCount: " + inferenceLoop.repCount + " / " + (currentPrescription?.repTarget ?? "?"),
                  "Exercise: " + (currentQueueItem?.displayName ?? "none"),
                  "Patient: " + patientProfile.type + " session#" + patientProfile.sessionNumber,
                  "Framing: " + framingPanelState.severity + " — " + framingPanelState.message,
                  "Coaching msg: " + (coachingPanelState.message ?? "none") + " [" + coachingPanelState.source + "]",
                  "API Status: " + aiEngineStatus,
                  "",
                  "=== DEBUG LOG (newest first) ===",
                  ...debugLog.map(e => "[" + e.timestamp + "] [" + e.level.toUpperCase() + "] [" + e.category + "] " + e.message + (e.detail ? " | " + e.detail.slice(0, 200) : ""))
                ].join("\n");
                copyToClipboard(snapshot);
              }}
              style={{ background: "rgba(155,231,176,0.15)", color: "#9be7b0", border: "1px solid rgba(155,231,176,0.3)", borderRadius: 6, padding: "3px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              📋 Copy Snapshot
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const text = debugLog.map(e => "[" + e.timestamp + "] [" + e.level.toUpperCase() + "] [" + e.category + "] " + e.message + (e.detail ? "\n  " + e.detail : "")).join("\n");
                copyToClipboard(text);
              }}
              style={{ background: "rgba(124,198,255,0.1)", color: "#7cc6ff", border: "1px solid rgba(124,198,255,0.2)", borderRadius: 6, padding: "3px 12px", fontSize: 11, cursor: "pointer" }}>
              Copy Log
            </button>
            <button onClick={(e) => { e.stopPropagation(); globalDebugLog = []; setDebugLog([]); }}
              style={{ background: "rgba(255,255,255,0.05)", color: "#7a88a8", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>
              Clear
            </button>
            <span style={{ color: "#7a88a8", fontSize: 12 }}>{debugOpen ? "▲" : "▼"}</span>
          </div>
        </div>

        {debugOpen && (
          <div style={{ maxHeight: 380, overflowY: "auto", padding: 10, display: "grid", gap: 3 }}>
            {debugLog.length === 0 ? (
              <div style={{ color: "#7a88a8", fontSize: 12, padding: "8px 4px" }}>
                No entries. Click Test to verify API, then begin a session.
              </div>
            ) : (
              debugLog.map((entry) => {
                const s = LOG_COLORS[entry.level];
                const isExpanded = expandedLogId === entry.id;
                return (
                  <div key={entry.id}
                    onClick={() => setExpandedLogId(isExpanded ? null : (entry.detail ? entry.id : null))}
                    style={{ background: s.bg, borderRadius: 6, padding: "5px 10px", cursor: entry.detail ? "pointer" : "default", border: `1px solid ${isExpanded ? s.color + "33" : "transparent"}` }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", flexShrink: 0 }}>{entry.timestamp}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: `${s.color}22`, color: s.color, flexShrink: 0 }}>{s.label}</span>
                      <span style={{ fontSize: 10, color: "#7a88a8", flexShrink: 0 }}>{entry.category}</span>
                      <span style={{ fontSize: 12, color: "white", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isExpanded ? "normal" : "nowrap" }}>{entry.message}</span>
                      {entry.detail && <span style={{ fontSize: 10, color: "#7a88a8", flexShrink: 0 }}>{isExpanded ? "▲" : "▼"}</span>}
                    </div>
                    {isExpanded && entry.detail && (
                      <div style={{ marginTop: 6, padding: "8px 10px", background: "rgba(0,0,0,0.3)", borderRadius: 6, fontSize: 11, color: "#aab6d3", fontFamily: "monospace", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {entry.detail}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── MOVEMENT TIMELINE ── */}
      <MovementTimelinePanel defaultOpen={true} />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
