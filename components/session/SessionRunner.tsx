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
import { getSupabaseClient } from "@/lib/supabase/client";
import { getBodyFrame } from "@/lib/pose/bodyFrame";
import { POSE_BUILDERS, REST_BUILDERS, lerpGhost, computeMatchScore } from "@/lib/pose/poseBuilders";
import { drawGhost, drawGhostDemo, drawLive, drawHoldRing } from "@/lib/pose/ghostRenderer";
import { poseFrameToLandmarkArray, mirrorLandmarks } from "@/lib/pose/poseFrameBridge";

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
    case "shoulder_flexion_right":     return "Raise your right arm forward and up. Hold at the target position, then lower slowly.";
    case "shoulder_flexion_left":      return "Raise your left arm forward and up. Hold at the target position, then lower slowly.";
    case "shoulder_flexion_bilateral": return "Raise both arms forward and up together. Hold at the target, then lower slowly.";
    case "shoulder_abduction_right":   return "Raise your right arm out to the side. Hold level with your shoulder, then lower slowly.";
    case "shoulder_abduction_left":    return "Raise your left arm out to the side. Hold level with your shoulder, then lower slowly.";
    case "shoulder_abduction_bilateral": return "Raise both arms out to the sides. Hold level with shoulders, then lower slowly.";
    case "sit_to_stand":               return "Rise to standing fully, hold briefly at full extension, then sit back down with control.";
    case "knee_extension_right":       return "Seated: straighten your right knee fully, hold at full extension, then lower slowly.";
    default: return "Perform the exercise with slow, controlled movement.";
  }
}

function getPositionRequirement(id: string | undefined): string {
  switch (id) {
    case "sit_to_stand": return "Start seated. Rise to full standing, then sit back down with control.";
    case "knee_extension_right": return "Remain seated throughout. Keep your hips level.";
    case "shoulder_flexion_right":
    case "shoulder_flexion_left":
    case "shoulder_flexion_bilateral": return "Remain upright. Seated or standing is fine.";
    case "shoulder_abduction_right":
    case "shoulder_abduction_left":
    case "shoulder_abduction_bilateral": return "Face the camera directly. Seated or standing is fine.";
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
// REST SCREEN OVERLAY
// ============================================================
// Shown between protocol blocks. Counts down and auto-advances.

function RestScreenOverlay({ restMs, onDone }: { restMs: number; onDone: () => void }) {
  const [remaining, setRemaining] = useState(Math.ceil(restMs / 1000));

  useEffect(() => {
    if (remaining <= 0) { onDone(); return; }
    const t = window.setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onDone]);

  const pct = Math.max(0, remaining / Math.ceil(restMs / 1000));

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(13,17,23,0.97)",
      zIndex: 500, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 24,
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ fontSize: 13, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
        Rest Period
      </div>
      {/* Countdown ring */}
      <div style={{ position: "relative", width: 160, height: 160 }}>
        <svg width="160" height="160" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
          <circle cx="80" cy="80" r="70" fill="none" stroke="#7cc6ff" strokeWidth="8"
            strokeDasharray={`${2 * Math.PI * 70}`}
            strokeDashoffset={`${2 * Math.PI * 70 * (1 - pct)}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ fontSize: 48, fontWeight: 800, color: "white", lineHeight: 1 }}>{remaining}</div>
          <div style={{ fontSize: 12, color: "#7d8590", marginTop: 4 }}>seconds</div>
        </div>
      </div>
      <div style={{ fontSize: 15, color: "#e6edf3", fontWeight: 500 }}>
        Next exercise coming up…
      </div>
      <button
        onClick={onDone}
        style={{
          marginTop: 8, padding: "10px 28px",
          background: "rgba(56,139,253,0.12)", color: "#388bfd",
          border: "1px solid rgba(56,139,253,0.3)", borderRadius: 8,
          fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Skip Rest →
      </button>
    </div>
  );
}

// ============================================================
// POST-SESSION SUMMARY OVERLAY
// ============================================================
// Shown when all exercises complete. AI summary + mobility score.

function SessionSummaryOverlay({ summary, patientName, sessionTitle, onDone }: {
  summary: {
    mobilityScore: number;
    durationMs: number;
    aiSummary: string;
    exerciseResults: { name: string; successful: number; prescribed: number; failed: number; }[];
  };
  patientName?: string;
  sessionTitle?: string;
  onDone: () => void;
}) {
  const scoreColor = summary.mobilityScore >= 80 ? "#3fb950" : summary.mobilityScore >= 60 ? "#d29922" : "#f85149";
  const mins = Math.floor(summary.durationMs / 60000);
  const secs = Math.floor((summary.durationMs % 60000) / 1000);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(13,17,23,0.98)",
      zIndex: 500, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "flex-start",
      overflowY: "auto", padding: "48px 24px",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#e6edf3", marginBottom: 6 }}>
            Session Complete{patientName ? `, ${patientName.split(" ")[0]}!` : "!"}
          </div>
          {sessionTitle && (
            <div style={{ fontSize: 14, color: "#7d8590" }}>{sessionTitle}</div>
          )}
        </div>

        {/* Mobility score */}
        <div style={{
          background: scoreColor + "12", border: `1px solid ${scoreColor}40`,
          borderRadius: 16, padding: "28px", textAlign: "center",
        }}>
          <div style={{ fontSize: 12, color: "#7d8590", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Mobility Score
          </div>
          <div style={{ fontSize: 80, fontWeight: 800, color: scoreColor, lineHeight: 1, marginBottom: 4 }}>
            {summary.mobilityScore}
          </div>
          <div style={{ fontSize: 14, color: "#7d8590" }}>out of 100</div>
          <div style={{ fontSize: 13, color: "#484f58", marginTop: 12 }}>
            Duration: {mins}m {secs}s · {summary.exerciseResults.length} exercise{summary.exerciseResults.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* AI Summary */}
        <div style={{
          background: "#161b22", border: "1px solid #21262d",
          borderRadius: 12, padding: "20px",
        }}>
          <div style={{ fontSize: 11, color: "#7d8590", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, fontWeight: 700 }}>
            Your Coach Says
          </div>
          <div style={{ fontSize: 15, color: "#e6edf3", lineHeight: 1.7 }}>
            {summary.aiSummary}
          </div>
        </div>

        {/* Exercise breakdown */}
        <div>
          <div style={{ fontSize: 11, color: "#7d8590", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12, fontWeight: 700 }}>
            Exercise Breakdown
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {summary.exerciseResults.map((ex, i) => {
              const pct = ex.prescribed > 0 ? Math.round(ex.successful / ex.prescribed * 100) : 0;
              const exColor = pct >= 80 ? "#3fb950" : pct >= 60 ? "#d29922" : "#f85149";
              return (
                <div key={i} style={{
                  background: "#161b22", border: "1px solid #21262d",
                  borderRadius: 10, padding: "12px 16px",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: exColor + "20", color: exColor,
                      fontSize: 12, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>{ex.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "#7d8590" }}>
                      {ex.successful}/{ex.prescribed} reps
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: exColor }}>{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Done button */}
        <button
          onClick={onDone}
          style={{
            padding: "14px 0", width: "100%",
            background: "#3fb950", color: "#0d1117",
            border: "none", borderRadius: 10,
            fontSize: 16, fontWeight: 800, cursor: "pointer",
            fontFamily: "inherit", letterSpacing: 0.3,
          }}
        >
          Done ✓
        </button>
      </div>
    </div>
  );
}

// ============================================================
// SESSION RUNNER
// ============================================================

interface SessionRunnerProps {
  prescriptionQueue?: import("@/lib/types/exercise").ExercisePrescription[];
  /** Rest periods between protocol blocks. afterIndex = last exercise index before rest. */
  restBoundaries?: { afterIndex: number; restMs: number }[];
  sessionTitle?: string;
  initialPatientProfile?: import("@/lib/patient/patientTypes").PatientProfile;
  /** Supabase UUID of the session — used to write results and update status */
  prescriptionId?: string;
  /** Supabase UUID of the patient in patients — written to session_results */
  patientId?: string;
  /** Registered patient full name — shown in pre-session card and coaching panel */
  patientName?: string;
}

export default function SessionRunner({ prescriptionQueue, restBoundaries = [], sessionTitle, initialPatientProfile, prescriptionId, patientId, patientName }: SessionRunnerProps = {}) {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;
  const cameraRef = useRef<CameraViewportHandle | null>(null);
  const sessionStartedAtMsRef = useRef<number | null>(null);
  // Ghost silhouette refs
  const ghostCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  // Refs hold latest values for rAF ghost loop - avoids stale closures
  const ghostFrameRef   = useRef<import("@/lib/types/pose").PoseFrame | null>(null);
  const ghostSlugRef    = useRef<string>("");
  const ghostHoldMsRef      = useRef<number>(0);
  const ghostPhaseInfRef    = useRef<string>("ready");  // inferenceLoop.phase
  const ghostHoldRemRef     = useRef<number|null>(null); // inferenceLoop.holdRemainingMs
  // Auto-frame viewport: CSS transform applied to the camera container div
  const cameraContainerRef = useRef<HTMLDivElement | null>(null);
  const vpScaleRef  = useRef(1);
  const vpOXRef     = useRef(0);
  const vpOYRef     = useRef(0);
  const vpRafRef    = useRef<number>(0);
  const ghostAnimRef   = useRef<number>(0);
  const ghostPhaseRef  = useRef<"demo"|"attempt"|"holding"|"rep_complete">("demo");
  const ghostStartRef  = useRef<number>(performance.now());
  const ghostHoldRef   = useRef<number|null>(null);
  const ghostLowRef    = useRef<number>(0);
  const ghostRepRef    = useRef<boolean>(false);
  const ghostHistRef   = useRef<number[]>([]);
  const [ghostScore, setGhostScore]         = useState(0);
  const [ghostHoldMs, setGhostHoldMs]       = useState(0);
  const [ghostPhase, setGhostPhase]         = useState<"demo"|"attempt"|"holding"|"rep_complete">("demo");
  const [ghostDemoProgress, setGhostDemoProgress] = useState(0);

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
  // Rest screen state — shown between protocol blocks
  const [restScreen, setRestScreen] = useState<{ restMs: number; onDone: () => void } | null>(null);
  // Post-session summary state — shown when all exercises complete
  const [sessionSummary, setSessionSummary] = useState<{
    mobilityScore: number;
    exerciseResults: { name: string; successful: number; prescribed: number; failed: number; }[];
    aiSummary: string;
    durationMs: number;
  } | null>(null);

  useEffect(() => {
    globalSetDebugLog = setDebugLog;
    return () => { globalSetDebugLog = null; };
  }, []);

  const sessionQueue = useSessionQueue();
  const inferenceLoop = useInferenceLoop();
  // Keep ghost refs current on every render so the rAF loop reads fresh data
  ghostFrameRef.current       = inferenceLoop.frame;
  ghostSlugRef.current        = sessionQueue.getActivePrescription()?.id ?? "";
  ghostHoldMsRef.current      = sessionQueue.getActivePrescription()?.hold.durationMs ?? 5000;
  ghostPhaseInfRef.current    = inferenceLoop.phase;  // inference loop phase drives ghost position
  ghostHoldRemRef.current     = inferenceLoop.holdRemainingMs;  // ms remaining in hold
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

    // Check if there's a rest boundary after the current exercise index
    const currentIndex = sessionQueue.queueIndex;
    const boundary = restBoundaries.find(b => b.afterIndex === currentIndex);

    sessionQueue.advanceQueue(
      (nextItem: QueueItem, nextIndex: number) => {
        writeDebugLog("info", "SESSION", "Advancing to: " + nextItem.displayName);
        inferenceLoop.resetTrackingState();

        const startNextExercise = () => {
          framingIntelligence.reset("Position yourself for the next exercise.");
          // Reset ghost to demo phase for new exercise
          ghostPhaseRef.current="demo"; ghostStartRef.current=performance.now();
          ghostHoldRef.current=null; ghostLowRef.current=0; ghostRepRef.current=false; ghostHistRef.current=[];
          setGhostPhase("demo"); setGhostDemoProgress(0); setGhostHoldMs(0);
          patientContext.beginExercise(nextItem.prescription, nextIndex, sessionQueue.getActiveQueue().length);
          framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), nextItem.prescription, Date.now());
          const waitForSpeech = () => {
            if (window.speechSynthesis?.speaking) {
              window.setTimeout(waitForSpeech, 300);
            } else {
              window.setTimeout(() => {
                stableCoachingCallbacks.onExerciseStarted(Date.now());
              }, 600);
            }
          };
          window.setTimeout(waitForSpeech, 300);
        };

        // If there's a rest period before this next block, show rest screen first
        if (boundary) {
          writeDebugLog("info", "SESSION", `Rest screen: ${boundary.restMs}ms before next block`);
          // Stop speech before rest
          window.speechSynthesis?.cancel();
          setRestScreen({ restMs: boundary.restMs, onDone: startNextExercise });
        } else {
          startNextExercise();
        }
      },
      () => {
        writeDebugLog("success", "SESSION", "All exercises complete");
        writeSessionResults();
      }
    );
  }, [sessionQueue, patientContext, coachingBrain, patientProfile, inferenceLoop, framingIntelligence, restBoundaries]);

  // ============================================================
  // SESSION RESULTS WRITER
  // ============================================================
  // Called when all exercises are complete.
  // Writes to session_results + exercise_results in Supabase,
  // then updates session_prescriptions.status → completed.
  // ============================================================

  async function writeSessionResults() {
    const summary = patientContext.buildSessionSummaryInput();
    if (!summary) {
      writeDebugLog("warning", "RESULTS", "buildSessionSummaryInput returned null — skipping write");
      return;
    }

    const supabase = getSupabaseClient();
    const completedAt = new Date().toISOString();
    const startedAt = sessionStartedAtMsRef.current
      ? new Date(sessionStartedAtMsRef.current).toISOString()
      : completedAt;
    const durationMs = sessionStartedAtMsRef.current
      ? Date.now() - sessionStartedAtMsRef.current
      : summary.totalDurationMs;

    const allEx = summary.exercises;
    const repCompletionRate = allEx.length > 0
      ? allEx.reduce((sum, ex) => sum + (ex.repTarget > 0 ? ex.successfulReps / ex.repTarget : 0), 0) / allEx.length
      : 0;
    const mobilityScore = Math.round(Math.min(100, repCompletionRate * 100));

    writeDebugLog("info", "RESULTS", `Writing session results — ${allEx.length} exercises, score: ${mobilityScore}`);

    // Generate AI summary for the patient
    let aiSummary = "Great work completing your session!";
    try {
      const exerciseSummaryText = allEx.map(ex =>
        `${ex.exerciseName}: ${ex.successfulReps}/${ex.repTarget} reps completed`
      ).join(", ");
      const summaryPrompt = `You are a warm, encouraging physiotherapy coach. The patient just completed their session. Write a 2-3 sentence summary for the patient (not the physio) that is warm, specific, and motivating. Mention their mobility score and any highlights. Keep it conversational and human — no bullet points, no medical jargon.

Session data:
- Mobility score: ${mobilityScore}/100
- Duration: ${Math.round(durationMs / 60000)} minutes
- Exercises: ${exerciseSummaryText}
- Patient type: ${patientProfile.type.replace(/_/g, " ")}

Reply with only the summary text, no JSON, no formatting.`;

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: summaryPrompt, system: "You are a warm physiotherapy coach. Reply with only the summary text requested — no JSON, no formatting, no preamble." }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.text) aiSummary = d.text;
      }
    } catch { /* use default */ }

    // Show post-session summary overlay immediately
    setSessionSummary({
      mobilityScore,
      durationMs,
      aiSummary,
      exerciseResults: allEx.map(ex => ({
        name: ex.exerciseName,
        successful: ex.successfulReps,
        prescribed: ex.repTarget,
        failed: ex.failedReps,
      })),
    });

    // Write to Supabase in background (don't block summary display)
    try {
      const { data: sessionResult, error: sessionErr } = await supabase
        .from("session_results")
        .insert({
          prescription_id: prescriptionId ?? null,
          patient_id: patientId ?? null,
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: durationMs,
          mobility_score: mobilityScore,
          claude_summary: aiSummary,
          physio_reviewed: false,
        })
        .select("id")
        .single();

      if (sessionErr || !sessionResult) {
        writeDebugLog("error", "RESULTS", "Failed to insert session_results", sessionErr?.message ?? "unknown");
        return;
      }

      const sessionResultId = sessionResult.id;
      writeDebugLog("success", "RESULTS", "session_results written", `id=${sessionResultId}`);

      const queue = sessionQueue.getActiveQueue();
      const exerciseRows = allEx.map((ex, i) => {
        const queueItem = queue[i];
        const repTarget = ex.repTarget;
        const attempted = ex.successfulReps + ex.failedReps;
        const holdCompliance = repTarget > 0 ? ex.successfulReps / repTarget : null;
        return {
          session_result_id: sessionResultId,
          template_id: null,
          prescription_exercise_id: null,
          sequence_order: i,
          reps_prescribed: repTarget,
          reps_attempted: attempted,
          reps_successful: ex.successfulReps,
          reps_failed: ex.failedReps,
          hold_compliance_rate: holdCompliance,
          avg_hold_ms: null,
          avg_metric_degrees: null,
          target_metric_degrees: queueItem?.prescription.target?.targetValue ?? null,
          failed_hold_count: ex.failureReasons.hold,
          failed_height_count: ex.failureReasons.height,
          failed_balance_count: ex.failureReasons.balance,
          failed_isolation_count: ex.failureReasons.isolation,
          movement_timeline: null,
        };
      });

      const { error: exErr } = await supabase.from("exercise_results").insert(exerciseRows);
      if (exErr) {
        writeDebugLog("error", "RESULTS", "Failed to insert exercise_results", exErr.message);
      } else {
        writeDebugLog("success", "RESULTS", `exercise_results written — ${exerciseRows.length} rows`);
      }

      if (prescriptionId) {
        const { error: statusErr } = await supabase
          .from("sessions")
          .update({ status: "completed" })
          .eq("id", prescriptionId);
        if (statusErr) {
          writeDebugLog("error", "RESULTS", "Failed to update session status", statusErr.message);
        } else {
          writeDebugLog("success", "RESULTS", "Session status → completed");
        }
      }

    } catch (err) {
      writeDebugLog("error", "RESULTS", "writeSessionResults threw", err instanceof Error ? err.message : String(err));
    }
  }

  // ============================================================
  // SESSION LIFECYCLE
  // ============================================================

  async function beginCombinedSession() {
    if (combinedQueue.length === 0) return;
    sessionStartedAtMsRef.current = Date.now();
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
    // Start ghost render loop
    ghostPhaseRef.current = "demo";
    ghostStartRef.current = performance.now();
    ghostHoldRef.current = null;
    ghostLowRef.current = 0;
    ghostRepRef.current = false;
    ghostHistRef.current = [];
    startGhostLoop();
    startAutoFrame();
  }

  function startAutoFrame() {
    cancelAnimationFrame(vpRafRef.current);
    function afTick() {
      const frame = ghostFrameRef.current;
      const container = cameraContainerRef.current;
      if (container && frame && frame.personDetected) {
        const lms = frame.landmarks as Record<string, {x:number;y:number;score?:number}|undefined>;
        const pts = Object.values(lms).filter(lm => lm && (lm.score ?? 1) > 0.15) as {x:number;y:number}[];
        if (pts.length >= 2) {
          const W = container.clientWidth; const H = container.clientHeight;
          let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
          for (const p of pts) { mnX=Math.min(mnX,p.x); mxX=Math.max(mxX,p.x); mnY=Math.min(mnY,p.y); mxY=Math.max(mxY,p.y); }
          const padX=(mxX-mnX)*0.35+0.05; const padY=(mxY-mnY)*0.28+0.05;
          const bx=Math.max(0,mnX-padX); const by=Math.max(0,mnY-padY);
          const bw=Math.min(1,mxX+padX)-bx; const bh=Math.min(1,mxY+padY)-by;
          const tScale=Math.max(1,Math.min(3.5,Math.min(1/bw,1/bh)));
          const tOX=0.5-(bx+bw/2)*tScale; const tOY=0.5-(by+bh/2)*tScale;
          const L=0.06;
          vpScaleRef.current += (tScale - vpScaleRef.current)*L;
          vpOXRef.current    += (tOX   - vpOXRef.current)*L;
          vpOYRef.current    += (tOY   - vpOYRef.current)*L;
          const s=vpScaleRef.current; const ox=vpOXRef.current; const oy=vpOYRef.current;
          container.style.transformOrigin = "top left";
          container.style.transform = `scale(${s}) translate(${(ox/s)*W}px, ${(oy/s)*H}px)`;
        }
      }
      vpRafRef.current = requestAnimationFrame(afTick);
    }
    vpRafRef.current = requestAnimationFrame(afTick);
  }

  function startGhostLoop() {
    cancelAnimationFrame(ghostAnimRef.current);
    const DEMO_CYCLE_S = 7;
    const INTENT_DELTA = 0.10; const INTENT_MIN = 0.20; const INTENT_WIN = 20;
    const MATCH_THRESHOLD = 0.85; const FAIL_THRESHOLD = 0.55; const LOW_TIMEOUT = 8;
    let lastT = performance.now();

    function easeInOut(t: number) { return t<0.5?4*t*t*t:1-(-2*t+2)**3/2; }
    function cycleT(e: number) {
      const t=(e%DEMO_CYCLE_S)/DEMO_CYCLE_S;
      if(t<0.14)return 0; if(t<0.43)return easeInOut((t-0.14)/0.29);
      if(t<0.64)return 1; if(t<0.93)return 1-easeInOut((t-0.64)/0.29); return 0;
    }

    function tick() {
      const canvas = ghostCanvasRef.current; if (!canvas) { ghostAnimRef.current = requestAnimationFrame(tick); return; }
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      const W = canvas.width; const H = canvas.height;
      const now = performance.now();
      const deltaS = Math.min((now - lastT) / 1000, 0.1); lastT = now;
      ctx.clearRect(0, 0, W, H);

      const frame = ghostFrameRef.current;
      if (!frame || !frame.personDetected) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      const rawLms = poseFrameToLandmarkArray(frame);
      const lms = mirrorLandmarks(rawLms);
      const slug = ghostSlugRef.current;
      if (!slug) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      const bodyFrame = getBodyFrame(lms as any, W, H);
      if (!bodyFrame) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      const tb = POSE_BUILDERS[slug]; const rb = REST_BUILDERS[slug];
      if (!tb || !rb) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      const tgt = tb(bodyFrame);
      const rst = rb(bodyFrame);
      const score = computeMatchScore(lms, slug, W, H);
      setGhostScore(score);

      const p = ghostPhaseRef.current;
      const elapsed = (now - ghostStartRef.current) / 1000;

      // Ghost is driven by inferenceLoop.phase — the clinical source of truth.
      // No independent state machine needed: the inference loop already knows
      // exactly where the patient is in the movement.
      const infPhase = ghostPhaseInfRef.current;
      const holdRem  = ghostHoldRemRef.current;
      const holdTotal = ghostHoldMsRef.current > 0 ? ghostHoldMsRef.current : 5000;

      if (infPhase === "ready" || infPhase === "idle" || infPhase === "unknown") {
        // Patient at rest or session just starting — animate ghost slowly to teach
        const t = 0.5 + 0.5 * Math.sin(now / 3500); // gentle 7s oscillation
        drawGhostDemo(ctx, lerpGhost(rst, tgt, t), t);
        setGhostPhase("demo");
        setGhostDemoProgress(t);

      } else if (infPhase === "lifting") {
        // Patient is raising — show target ghost in blue, encouraging "get here"
        drawGhost(ctx, tgt, score);
        setGhostPhase("attempt");
        setGhostHoldMs(0);

      } else if (infPhase === "top" || infPhase === "holding") {
        // Patient at peak — show target ghost green + hold countdown ring
        drawGhost(ctx, tgt, Math.max(score, 0.85)); // always green at top
        setGhostPhase("holding");
        // holdRem is ms REMAINING; convert to elapsed for the ring
        const holdElapsed = holdRem !== null ? Math.max(0, holdTotal - holdRem) : holdTotal;
        setGhostHoldMs(holdElapsed);
        drawHoldRing(ctx, W, H, holdElapsed, holdTotal, 1);

      } else if (infPhase === "lowering") {
        // Patient lowering — ghost lerps toward rest position, encouraging them down
        const lowerT = 0.3 + 0.7 * Math.sin(now / 1500) * 0.3; // subtle rest-leaning pose
        drawGhost(ctx, lerpGhost(tgt, rst, 0.4), score);
        setGhostPhase("attempt");
        setGhostHoldMs(0);

      } else if (infPhase === "complete" || infPhase === "bottom") {
        // Rep complete — brief green flash at target
        drawGhost(ctx, tgt, 1);
        setGhostPhase("rep_complete");
        setGhostHoldMs(0);

      } else {
        // Fallback for any other phase — show target
        drawGhost(ctx, tgt, score);
        setGhostPhase("attempt");
      }

      drawLive(ctx, lms, W, H, score);
      ghostAnimRef.current = requestAnimationFrame(tick);
    }
    ghostAnimRef.current = requestAnimationFrame(tick);
  }

  function handleCameraStop() {
    writeDebugLog("info", "CAMERA", "Camera stopped");
    inferenceLoop.stopLoop();
    cancelAnimationFrame(ghostAnimRef.current);
    cancelAnimationFrame(vpRafRef.current);
    // Reset viewport transform
    if (cameraContainerRef.current) cameraContainerRef.current.style.transform = "";
    vpScaleRef.current=1; vpOXRef.current=0; vpOYRef.current=0;
    sessionQueue.endSession();
    framingIntelligence.reset("Camera is off.");
    coachingBrain.reset();
    setGhostScore(0); setGhostHoldMs(0);
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
            Rehably
          </h1>
          <div style={{ fontSize: 12, color: "#7a88a8", marginTop: 2 }}>
            AI Rehabilitation Intelligence
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start", marginBottom: 16 }}>

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

          <div style={{ overflow: "hidden", borderRadius: 12 }}>
          <div ref={cameraContainerRef} style={{ position: "relative", transition: "none" }}>
            <CameraViewport ref={cameraRef} onVideoReady={handleCameraReady} onCameraStop={handleCameraStop} showStartButton={false} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <PoseCanvasOverlay frame={inferenceLoop.frame} />
            </div>
            {/* Ghost silhouette canvas — layered on top of pose skeleton */}
            <canvas
              ref={ghostCanvasRef}
              width={640} height={480}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: sessionQueue.sessionStarted ? 1 : 0, transition: "opacity 0.5s ease" }}
            />
            {/* Match score badge — top left, hidden during hold (ring takes over) */}
            {sessionQueue.sessionStarted && ghostPhase !== "holding" && (
              <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(13,17,23,0.78)", backdropFilter: "blur(8px)", borderRadius: 10, padding: "8px 12px", border: "1px solid rgba(124,198,255,0.3)", minWidth: 72 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: ghostScore >= 0.85 ? "#4ade80" : "#7cc6ff", lineHeight: 1 }}>{Math.round(ghostScore*100)}%</div>
                <div style={{ fontSize: 10, color: "#7d8590", marginTop: 2 }}>match</div>
                <div style={{ marginTop: 5, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round(ghostScore*100)}%`, background: ghostScore >= 0.85 ? "#4ade80" : "#7cc6ff", borderRadius: 2, transition: "width 0.2s ease" }} />
                </div>
              </div>
            )}
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
              Patient: <strong style={{ color: "white" }}>{patientName ?? patientProfile.type.replace(/_/g, " ")}</strong>
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

      {/* ── PRE-SESSION CARD (prescription mode) ── */}
      {prescriptionQueue && prescriptionQueue.length > 0 && !sessionQueue.sessionStarted && (
        <div style={{ background: "#1a2040", borderRadius: 12, padding: 20, border: "1px solid rgba(124,198,255,0.2)", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 4 }}>
                Your Session
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "white" }}>
                {sessionTitle ?? "Prescribed Session"}
              </div>
              {patientName && (
                <div style={{ fontSize: 13, color: "#aab6d3", marginTop: 3 }}>
                  Patient: <strong style={{ color: "white" }}>{patientName}</strong>
                  {" · "}<span style={{ color: "#7a88a8" }}>{patientProfile.type.replace(/_/g, " ")}</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                formatDurationRange(combinedDurationSeconds),
                `${combinedQueue.length} exercise${combinedQueue.length !== 1 ? "s" : ""}`,
                `${combinedTotalReps} reps`
              ].map(label => (
                <span key={label} style={{
                  padding: "4px 12px", borderRadius: 999,
                  background: "rgba(124,198,255,0.08)", color: "#7cc6ff",
                  fontSize: 12, fontWeight: 600
                }}>{label}</span>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
            {combinedQueue.map((item, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: "rgba(124,198,255,0.12)", color: "#7cc6ff",
                    fontSize: 11, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "white" }}>{item.displayName}</span>
                </div>
                <span style={{ fontSize: 12, color: "#7a88a8" }}>
                  {item.prescription.repTarget} reps
                  {item.prescription.hold.required ? ` · ${item.prescription.hold.durationMs / 1000}s hold` : ""}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={beginCombinedSession}
            disabled={!canBegin}
            style={{
              width: "100%", padding: "12px 0",
              background: canBegin ? "#9be7b0" : "rgba(155,231,176,0.2)",
              color: canBegin ? "#08111f" : "#7a88a8",
              fontWeight: 800, fontSize: 15,
              borderRadius: 10, border: "none",
              cursor: canBegin ? "pointer" : "not-allowed",
              letterSpacing: 0.3
            }}
          >
            Begin Session
          </button>
        </div>
      )}

      {/* ── SESSION CONTROLS (prescription mode — session running) ── */}
      {prescriptionQueue && prescriptionQueue.length > 0 && sessionQueue.sessionStarted && (
        <div style={{ background: "#1a2040", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#aab6d3" }}>
            {patientName && <><strong style={{ color: "white" }}>{patientName}</strong>{" · "}</>}
            <span style={{ color: "#7cc6ff" }}>{sessionTitle ?? "Session"}</span>
            {" · "}Exercise {sessionQueue.queueIndex + 1} of {sessionQueue.getActiveQueue().length}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={endSession} style={{
              background: "rgba(124,198,255,0.1)", color: "#7cc6ff", padding: "7px 14px",
              borderRadius: 8, border: "1px solid rgba(124,198,255,0.2)", cursor: "pointer", fontSize: 13
            }}>End</button>
            <button onClick={resetSession} style={{
              background: "rgba(255,255,255,0.06)", color: "#aab6d3", padding: "7px 14px",
              borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13
            }}>Reset</button>
          </div>
        </div>
      )}

      {/* ── SESSION SELECTOR (local builder mode only — hidden when prescription loaded) ── */}
      {!prescriptionQueue?.length && (
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
      )}

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

      {/* ── REST SCREEN OVERLAY ── */}
      {restScreen && (
        <RestScreenOverlay
          restMs={restScreen.restMs}
          onDone={() => { setRestScreen(null); restScreen.onDone(); }}
        />
      )}

      {/* ── POST-SESSION SUMMARY OVERLAY ── */}
      {sessionSummary && (
        <SessionSummaryOverlay
          summary={sessionSummary}
          patientName={patientName}
          sessionTitle={sessionTitle}
          onDone={() => {
            setSessionSummary(null);
            if (prescriptionId) {
              window.location.href = `/patient?id=${patientId ?? ""}`;
            }
          }}
        />
      )}

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
