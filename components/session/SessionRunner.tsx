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
import { drawLive, drawHoldRing } from "@/lib/pose/ghostRenderer";
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

function SessionSummaryOverlay({ summary, patientName, sessionTitle, onDone, onViewLogs }: {
  summary: {
    mobilityScore: number;
    durationMs: number;
    aiSummary: string;
    exerciseResults: { name: string; successful: number; prescribed: number; failed: number; }[];
  };
  patientName?: string;
  sessionTitle?: string;
  onDone: () => void;
  onViewLogs: () => void;
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

        {/* Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          <button
            onClick={onViewLogs}
            style={{
              padding: "11px 0", width: "100%",
              background: "transparent", color: "#7d8590",
              border: "1px solid #30363d", borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            View Debug Logs
          </button>
        </div>
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

// Debug entry types — defined outside component to avoid SWC/Next.js issues
type GhostLogEntry = { id: string; time: string; phase: string; score: number; rep: number; detail: string; };

// Rep cycle debug entry
type RepCycleEntry = {
  id: string; time: string; event: string;
  metricValue: number | null; targetThreshold: number | null;
  startThreshold: number | null; romAcceptableMin: number | null;
  romNormDegrees: number | null; romTargetDegrees: number | null;
  encourageThreshold: number | null; repCount: number; detail: string;
};

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
  // ROM score ring: kept current via render-time assignment (same pattern as ghostHoldMsRef)
  const ghostTargetThreshRef  = useRef<number | null>(null);
  const ghostCalibBaselineRef = useRef<number>(0);
  // Direct ref to active prescription object — reads post-calibration mutated targetThreshold
  const ghostPrescriptionRef  = useRef<import("@/lib/types/exercise").ExercisePrescription | null>(null);
  // Active metric value — state is stale in rAF closure, must use ref
  const ghostActiveMetricRef  = useRef<number | null>(null);
  // Auto-frame viewport: CSS transform applied to the camera container div
  const cameraContainerRef = useRef<HTMLDivElement | null>(null);
  const vpScaleRef  = useRef(1);
  const vpOXRef     = useRef(0);
  const vpOYRef     = useRef(0);
  const vpRafRef    = useRef<number>(0);
  const ghostAnimRef      = useRef<number>(0);
  const ghostLastFrameRef    = useRef<import("@/lib/pose/bodyFrame").BodyFrame | null>(null);
  const ghostSmoothedOriginX = useRef<number>(0);
  const ghostSmoothedOriginY = useRef<number>(0);
  const ghostSmoothedADX     = useRef<number>(0);
  const ghostSmoothedADY     = useRef<number>(1);
  const ghostSmoothedARX     = useRef<number>(1);
  const ghostSmoothedARY     = useRef<number>(0);
  const ghostSmoothedTorso   = useRef<number>(0);
  const ghostSmoothedSW      = useRef<number>(0);
  const ghostFrameInitRef    = useRef<boolean>(false);
  const ghostRepCountRef  = useRef<number>(0);   // tracks reps to distinguish first-rep ready vs between-rep ready
  const ghostPrevPhaseRef = useRef<string>("");  // detect phase transitions for debug log
  const ghostReadyStartRef = useRef<number>(0); // when ready phase started, for animation after wait
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
  // Ghost intelligence log — phase transitions and key events
  const [ghostLog, setGhostLog] = useState<GhostLogEntry[]>([]);
  const [ghostLogOpen, setGhostLogOpen] = useState(false);
  const ghostLogRef = useRef<GhostLogEntry[]>([]);
  const ghostSetLogRef = useRef<React.Dispatch<React.SetStateAction<GhostLogEntry[]>> | null>(null);
  ghostSetLogRef.current = setGhostLog;

  // ── Rep Cycle Debug Log ────────────────────────────────────────────────
  const [repCycleLog, setRepCycleLog] = useState<RepCycleEntry[]>([]);
  const [repCycleOpen, setRepCycleOpen] = useState(false);
  const repCycleLogRef = useRef<RepCycleEntry[]>([]);
  const [aiEngineStatus, setAiEngineStatus] = useState<"untested" | "ok" | "error" | "checking">("untested");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile>(
  initialPatientProfile ?? createDefaultPatientProfile()
);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [voiceEnabled, setVoiceEnabledState] = useState(true);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
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

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const sessionQueue = useSessionQueue();
  const inferenceLoop = useInferenceLoop();
  // Keep ghost refs current on every render so the rAF loop reads fresh data
  ghostFrameRef.current       = inferenceLoop.frame;
  ghostSlugRef.current        = sessionQueue.getActivePrescription()?.id ?? "";
  ghostHoldMsRef.current      = sessionQueue.getActivePrescription()?.hold.durationMs ?? 5000;
  ghostTargetThreshRef.current  = sessionQueue.getActivePrescription()?.targetThreshold ?? null;
  ghostPrescriptionRef.current  = sessionQueue.getActivePrescription() ?? null;
  ghostActiveMetricRef.current  = inferenceLoop.activeMetricValue;
  // ghostCalibBaselineRef not needed — reading inferenceLoop.calibrationBaselineRef.current directly in tick
  ghostPhaseInfRef.current    = inferenceLoop.phase;
  ghostHoldRemRef.current     = inferenceLoop.holdRemainingMs;
  ghostRepCountRef.current    = inferenceLoop.repCount;
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

  // Per-exercise accumulators for session results writing
  // Key = sequence index in queue, value = array of per-rep values
  const exercisePeakMetricsRef = useRef<Record<number, number[]>>({});
  const exerciseHoldDurationsRef = useRef<Record<number, number[]>>({});

  const readinessEvaluator = useCallback((frame: any, features: any, prescription: any) => {
    const r = evaluateReadiness({ frame, features, prescription, averageBrightness: null });
    return { ready: r.ready, message: r.message };
  }, []);

  const coachingCallbacks = useMemo(() => ({
    onRepCompleted: (nowMs: number, peakMetric: number | null, holdDurationMs: number | null) => {
      const prescription = sessionQueue.getActivePrescription();
      const exerciseCtx = patientContext.getCurrentExerciseContext();
      const metricVal = inferenceLoop.activeMetricValue;
      const tgtThresh = prescription?.targetThreshold ?? null;
      const romMin = (prescription as any)?.romAcceptableMin ?? null;
      const romNorm = (prescription as any)?.romNormDegrees ?? null;
      const romTarget = (prescription as any)?.romTargetDegrees ?? null;
      const encourage = (prescription as any)?.encourageThreshold ?? null;
      writeDebugLog("info", "COACHING", "Rep completed event fired", "prescription=" + (prescription?.id ?? "null") + " ctx=" + (exerciseCtx ? "ok" : "null") + " repCount=" + ((exerciseCtx?.repCount ?? 0) + 1));
      writeDebugLog("success", "REP_CYCLE",
        "✓ REP COMPLETE #" + ((exerciseCtx?.repCount ?? 0) + 1),
        "metric=" + (metricVal?.toFixed(1) ?? "?") + "° | peak=" + (peakMetric?.toFixed(1) ?? "?") + "° | targetThresh=" + (tgtThresh?.toFixed(1) ?? "?") + "° | physioTarget=" + (romTarget ?? "population") + "° | romMin=" + (romMin ?? "?") + "°"
      );
      const rcEntryRep: RepCycleEntry = {
        id: `${nowMs}-${Math.random().toString(36).slice(2,5)}`,
        time: new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2 }),
        event: "REP COMPLETE",
        metricValue: metricVal, targetThreshold: tgtThresh,
        startThreshold: prescription?.startThreshold ?? null,
        romAcceptableMin: romMin, romNormDegrees: romNorm,
        romTargetDegrees: romTarget, encourageThreshold: encourage,
        repCount: (exerciseCtx?.repCount ?? 0) + 1,
        detail: "metric=" + (metricVal?.toFixed(1) ?? "?") + "° | peak=" + (peakMetric?.toFixed(1) ?? "?") + "° | targetThresh=" + (tgtThresh?.toFixed(1) ?? "?") + "° | physioTarget=" + (romTarget !== null ? romTarget + "°" : "population") + " | encourage=" + (encourage !== null ? encourage + "°" : "none") + " | romMin=" + (romMin ?? "?") + "° | romNorm=" + (romNorm ?? "?") + "°",
      };
      repCycleLogRef.current = [rcEntryRep, ...repCycleLogRef.current].slice(0, 100);
      setRepCycleLog([...repCycleLogRef.current]);
      if (!prescription || !exerciseCtx) { writeDebugLog("error", "COACHING", "onRepCompleted BLOCKED — null ctx or prescription"); return; }
      recordRepCompleted(exerciseCtx.repCount, nowMs);

      // Accumulate peak metric and hold duration for this exercise
      const queueIdx = sessionQueue.getActiveQueueIndex?.() ?? 0;
      if (peakMetric !== null) {
        if (!exercisePeakMetricsRef.current[queueIdx]) exercisePeakMetricsRef.current[queueIdx] = [];
        exercisePeakMetricsRef.current[queueIdx].push(peakMetric);
      }
      if (holdDurationMs !== null) {
        if (!exerciseHoldDurationsRef.current[queueIdx]) exerciseHoldDurationsRef.current[queueIdx] = [];
        exerciseHoldDurationsRef.current[queueIdx].push(holdDurationMs);
      }

      // coachingBrain.onRepCompleted expects 0-indexed repCount (pre-increment).
      // Pass exerciseCtx captured BEFORE recordRepOutcome increments it.
      // recordRepOutcome is called after so patientContext sentiment/fatigue
      // state stays accurate, but the brain gets the value it was designed for.
      writeDebugLog("info", "COACHING", "Calling coachingBrain.onRepCompleted");
      coachingBrain.onRepCompleted({ prescription, patientProfile, exerciseContext: exerciseCtx, nowMs });
      patientContext.recordRepOutcome("success", null, holdDurationMs);
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
      const metricVal = inferenceLoop.activeMetricValue;
      const tgtThresh = prescription?.targetThreshold ?? null;
      const strtThresh = prescription?.startThreshold ?? null;
      const romMin = (prescription as any)?.romAcceptableMin ?? null;
      const romNorm = (prescription as any)?.romNormDegrees ?? null;
      const romTarget = (prescription as any)?.romTargetDegrees ?? null;
      const encourage = (prescription as any)?.encourageThreshold ?? null;
      writeDebugLog("info", "COACHING", "Hold started (" + holdRequiredMs + "ms)");
      writeDebugLog("success", "REP_CYCLE",
        "⏱ HOLD START | metric=" + (metricVal?.toFixed(1) ?? "?") + "° targetThresh=" + (tgtThresh?.toFixed(1) ?? "?") + "°",
        "physioTarget=" + (romTarget !== null ? romTarget + "°" : "population") + " | encourage=" + (encourage !== null ? encourage + "°" : "none") + " | romMin=" + (romMin ?? "?") + "° | romNorm=" + (romNorm ?? "?") + "° | startThresh=" + (strtThresh ?? "?") + "° | rep=" + (exerciseCtx?.repCount ?? "?") + " | ex=" + (prescription?.id ?? "?")
      );
      // Add to rep cycle log
      const rcEntry: RepCycleEntry = {
        id: `${nowMs}-${Math.random().toString(36).slice(2,5)}`,
        time: new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2 }),
        event: "HOLD START",
        metricValue: metricVal, targetThreshold: tgtThresh,
        startThreshold: strtThresh, romAcceptableMin: romMin, romNormDegrees: romNorm,
        romTargetDegrees: romTarget, encourageThreshold: encourage,
        repCount: exerciseCtx?.repCount ?? 0,
        detail: "metric=" + (metricVal?.toFixed(1) ?? "?") + "° | targetThresh=" + (tgtThresh?.toFixed(1) ?? "?") + "° | physioTarget=" + (romTarget !== null ? romTarget + "°" : "population") + " | encourage=" + (encourage !== null ? encourage + "°" : "none") + " | romMin=" + (romMin ?? "?") + "° | romNorm=" + (romNorm ?? "?") + "°",
      };
      repCycleLogRef.current = [rcEntry, ...repCycleLogRef.current].slice(0, 100);
      setRepCycleLog([...repCycleLogRef.current]);
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
    onRepCompleted: (nowMs: number, peakMetric: number | null, holdDurationMs: number | null) => coachingCallbacksRef.current.onRepCompleted(nowMs, peakMetric, holdDurationMs),
    onRepFailed: (reason: string, nowMs: number) => coachingCallbacksRef.current.onRepFailed(reason, nowMs),
    onHoldStarted: (ms: number, nowMs: number) => coachingCallbacksRef.current.onHoldStarted(ms, nowMs),
    onExerciseStarted: (nowMs: number) => coachingCallbacksRef.current.onExerciseStarted(nowMs),
    feedFrame: (params: any) => coachingCallbacksRef.current.feedFrame(params),
  }).current;

  const framingCallbacks = useMemo(() => ({
    evaluateFraming: framingIntelligence.evaluateFraming,
    cancelPendingEval: framingIntelligence.cancelPendingEval,
  }), [framingIntelligence.evaluateFraming, framingIntelligence.cancelPendingEval]);

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
          // Fire coaching intro first, then wait for it to finish, THEN run framing check.
          // Framing cue must fire into a clear audio window — never compete with intro speech.
          stableCoachingCallbacks.onExerciseStarted(Date.now());
          writeDebugLog("info", "FRAMING", "Next exercise intro fired — framing check scheduled after speech");
          const waitForIntroThenCheck = () => {
            if (window.speechSynthesis?.speaking) {
              window.setTimeout(waitForIntroThenCheck, 300);
            } else {
              writeDebugLog("info", "FRAMING", "Intro speech done — running forcePreExerciseCheck");
              framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), nextItem.prescription, Date.now());
            }
          };
          window.setTimeout(waitForIntroThenCheck, 500);
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

        // Aggregate per-rep peak metrics collected during the session
        const peakMetrics = exercisePeakMetricsRef.current[i] ?? [];
        const avgMetric = peakMetrics.length > 0
          ? peakMetrics.reduce((a, b) => a + b, 0) / peakMetrics.length
          : null;

        // Aggregate per-rep hold durations collected during the session
        const holdDurations = exerciseHoldDurationsRef.current[i] ?? [];
        const avgHold = holdDurations.length > 0
          ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length
          : null;

        // target_metric_degrees = the calibrated physio target the patient was
        // working toward — targetThreshold is post-calibration physio target,
        // NOT target.targetValue which is romNorm (population norm, not the goal)
        const targetMetric = queueItem?.prescription.targetThreshold ?? null;

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
          avg_hold_ms: avgHold,
          avg_metric_degrees: avgMetric,
          target_metric_degrees: targetMetric,
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
    // startLoop fires onExerciseStarted internally → coaching intro speech begins.
    // liveFrameRef starts accumulating real landmark data from frame 1.
    inferenceLoop.startLoop(video, sessionQueue.getActivePrescription, handleExerciseComplete, stableCoachingCallbacks, framingCallbacks, readinessEvaluator);
    writeDebugLog("info", "FRAMING", "Inference loop started — waiting for intro speech to finish before framing check");
    // forcePreExerciseCheck must fire AFTER intro speech completes so the framing cue
    // has a clear audio window — never compete with coaching intro.
    const waitForIntroThenCheck = () => {
      if (window.speechSynthesis?.speaking) {
        window.setTimeout(waitForIntroThenCheck, 300);
      } else {
        writeDebugLog("info", "FRAMING", "Intro speech done — running forcePreExerciseCheck");
        framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), prescription, Date.now());
      }
    };
    // Give startLoop 600ms to call onExerciseStarted and start speech before polling
    window.setTimeout(waitForIntroThenCheck, 600);
    // Start ghost render loop
    ghostPhaseRef.current = "demo";
    ghostStartRef.current = performance.now();
    ghostHoldRef.current = null;
    ghostLowRef.current = 0;
    ghostRepRef.current = false;
    ghostHistRef.current = [];
    // Do NOT clear ghostLastFrameRef here — cached frame keeps ghost visible at rest
    // Reset frame smoothing so new exercise anchors cleanly
    ghostFrameInitRef.current = false;
    ghostRepCountRef.current = 0;
    ghostPrevPhaseRef.current = "";
    ghostReadyStartRef.current = performance.now();
    ghostLogRef.current = [];
    ghostSetLogRef.current?.([]);
    startGhostLoop();
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
      // Use fixed 640x480 buffer — canvas is styled to 100% via CSS
      // Landmarks are normalised 0-1 so they scale correctly with any W/H
      const W = 640; const H = 480;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W; canvas.height = H;
      }
      const now = performance.now();
      const deltaS = Math.min((now - lastT) / 1000, 0.1); lastT = now;
      ctx.clearRect(0, 0, W, H);

      const frame = ghostFrameRef.current;
      if (!frame || !frame.personDetected) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      const rawLms = poseFrameToLandmarkArray(frame);
      const lms    = mirrorLandmarks(rawLms);
      const slug   = ghostSlugRef.current;
      if (!slug) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      // Simple landmark-based ghost: anchor directly to detected shoulder positions.
      // No body frame coordinate system — eliminates all drift and rotation bugs.
      // We only show the relevant arm(s) for each exercise, nothing else.
      const freshFrame = getBodyFrame(lms as any, W, H);
      // SMOOTHED BODY FRAME: LERP the origin and axes to prevent ghost drift
      // when shoulder landmarks shift as arms raise overhead.
      // During active movement phases, freeze the frame (only update in ready phase).
      const currentInfPhase = ghostPhaseInfRef.current;
      const canUpdateFrame = freshFrame !== null && (
        currentInfPhase === "ready" || currentInfPhase === "idle" || currentInfPhase === "unknown"
      );
      if (freshFrame && canUpdateFrame) {
        // LERP speed: fast during ready (0.15), frozen during active phases
        const L = 0.15;
        if (!ghostFrameInitRef.current) {
          // First frame — snap immediately, no lerp
          ghostSmoothedOriginX.current = freshFrame.origin.x;
          ghostSmoothedOriginY.current = freshFrame.origin.y;
          ghostSmoothedADX.current = freshFrame.axisDown.x;
          ghostSmoothedADY.current = freshFrame.axisDown.y;
          ghostSmoothedARX.current = freshFrame.axisRight.x;
          ghostSmoothedARY.current = freshFrame.axisRight.y;
          ghostSmoothedTorso.current = freshFrame.torsoLen;
          ghostSmoothedSW.current = freshFrame.shoulderWidth;
          ghostFrameInitRef.current = true;
        } else {
          ghostSmoothedOriginX.current += (freshFrame.origin.x - ghostSmoothedOriginX.current) * L;
          ghostSmoothedOriginY.current += (freshFrame.origin.y - ghostSmoothedOriginY.current) * L;
          // LERP axes then RE-NORMALIZE — lerped vectors lose unit length and orthogonality
          const adX = ghostSmoothedADX.current + (freshFrame.axisDown.x - ghostSmoothedADX.current) * L;
          const adY = ghostSmoothedADY.current + (freshFrame.axisDown.y - ghostSmoothedADY.current) * L;
          const adM = Math.sqrt(adX*adX + adY*adY) || 1;
          ghostSmoothedADX.current = adX / adM;
          ghostSmoothedADY.current = adY / adM;
          const arX = ghostSmoothedARX.current + (freshFrame.axisRight.x - ghostSmoothedARX.current) * L;
          const arY = ghostSmoothedARY.current + (freshFrame.axisRight.y - ghostSmoothedARY.current) * L;
          const arM = Math.sqrt(arX*arX + arY*arY) || 1;
          ghostSmoothedARX.current = arX / arM;
          ghostSmoothedARY.current = arY / arM;
          ghostSmoothedTorso.current += (freshFrame.torsoLen - ghostSmoothedTorso.current) * L;
          ghostSmoothedSW.current += (freshFrame.shoulderWidth - ghostSmoothedSW.current) * L;
        }
        ghostLastFrameRef.current = freshFrame;
      } else if (freshFrame && !ghostFrameInitRef.current) {
        // First frame even during active phase — snap
        ghostSmoothedOriginX.current = freshFrame.origin.x;
        ghostSmoothedOriginY.current = freshFrame.origin.y;
        ghostSmoothedADX.current = freshFrame.axisDown.x;
        ghostSmoothedADY.current = freshFrame.axisDown.y;
        ghostSmoothedARX.current = freshFrame.axisRight.x;
        ghostSmoothedARY.current = freshFrame.axisRight.y;
        ghostSmoothedTorso.current = freshFrame.torsoLen;
        ghostSmoothedSW.current = freshFrame.shoulderWidth;
        ghostFrameInitRef.current = true;
        ghostLastFrameRef.current = freshFrame;
      }
      // Build stable body frame from smoothed values
      if (!ghostFrameInitRef.current) { ghostAnimRef.current = requestAnimationFrame(tick); return; }
      const lastF = ghostLastFrameRef.current!;
      const bodyFrame: import("@/lib/pose/bodyFrame").BodyFrame = {
        ...lastF,
        origin:      { x: ghostSmoothedOriginX.current, y: ghostSmoothedOriginY.current },
        axisDown:    { x: ghostSmoothedADX.current,     y: ghostSmoothedADY.current },
        axisRight:   { x: ghostSmoothedARX.current,     y: ghostSmoothedARY.current },
        torsoLen:    ghostSmoothedTorso.current,
        shoulderWidth: ghostSmoothedSW.current,
      };

      // ── Ghost v18: Fixed-direction, shoulder-anchored ────────────────────────
      // Architecture:
      // 1. Shoulder pixel position = anchor (most stable landmark always)
      // 2. Arm length = shoulderWidth * ratio, measured during ready phase
      //    and FROZEN once active — never recalculated during movement
      // 3. Direction vectors are fixed per exercise type — no elbow/wrist
      //    landmarks used in ghost geometry at all
      // 4. ghostT (0→1) drives animation smoothly via infPhase
      //
      // This eliminates all size instability and tilt/snap issues.
      // The ghost is a clean leading indicator, not a follower.

      // ── ROM score: elevation-based, patient-specific ─────────────────────
      // Both values read from refs that hold live object references.
      // ALL inferenceLoop state values are stale in the rAF closure — must use refs.
      // ghostActiveMetricRef: current activeMetricValue, assigned at render time
      // calibrationBaselineRef: mutated in-place by useInferenceLoop when calibration completes
      // ghostPrescriptionRef: same prescription object calibration mutates in-place
      const activePxMetric = ghostActiveMetricRef.current;
      const calibBaseline = inferenceLoop.calibrationBaselineRef.current;
      const tgtThreshForScore = ghostPrescriptionRef.current?.targetThreshold ?? null;
      let score = 0;
      if (activePxMetric !== null && tgtThreshForScore !== null && tgtThreshForScore > calibBaseline) {
        score = Math.max(0, Math.min(1, (activePxMetric - calibBaseline) / (tgtThreshForScore - calibBaseline)));
      }
      setGhostScore(score);

      // ── SCORE DEBUG LOG (fires every ~2s) ──────────────────────────────
      if (Math.floor(now / 2000) !== Math.floor((now - 16) / 2000)) {
        console.log(
          `[SCORE DEBUG] score=${Math.round(score * 100)}%` +
          ` | metric=${activePxMetric?.toFixed(1) ?? "null"}°` +
          ` | calibBaseline=${calibBaseline.toFixed(1)}°` +
          ` | tgtThresh=${tgtThreshForScore?.toFixed(1) ?? "null"}°` +
          ` | prescriptionNull=${ghostPrescriptionRef.current === null}`
        );
      }

      // Shoulder anchors — most reliable landmarks at all arm positions
      const lsLm = lms[11]; const rsLm = lms[12];
      const lsVis = !!lsLm && (lsLm.visibility ?? 1) > 0.25;
      const rsVis = !!rsLm && (rsLm.visibility ?? 1) > 0.25;

      if (!lsVis && !rsVis) {
        drawLive(ctx, lms, W, H, score);
        ghostAnimRef.current = requestAnimationFrame(tick);
        return;
      }

      // ── Arm length — computed from smoothed shoulder width, frozen when active ──
      // shoulderWidth is already smoothed and frozen during active phases
      // by the body frame system above. Use it directly.
      // shoulderWidth from bodyFrame is already in canvas pixels — do NOT multiply by W
      const swPx = ghostSmoothedSW.current;
      const upperArmPx = swPx * 1.05; // tuned for correct visual proportion
      const foreArmPx  = swPx * 0.90;

      // ── Exercise flags ────────────────────────────────────────────────────
      const isFlexion   = slug.includes("flexion");
      const isAbduction = slug.includes("abduction");
      const isKnee      = slug.includes("knee_extension");
      const isSTS       = slug === "sit_to_stand";
      const isRight     = slug.includes("_right") || slug.includes("bilateral");
      const isLeft      = slug.includes("_left")  || slug.includes("bilateral");

      // ── Phase → ghostT ────────────────────────────────────────────────────
      const infPhase  = ghostPhaseInfRef.current;
      const holdRem   = ghostHoldRemRef.current;
      const holdTotal = ghostHoldMsRef.current > 0 ? ghostHoldMsRef.current : 5000;
      const readyElapsedS = (now - ghostReadyStartRef.current) / 1000;
      const repsDone  = ghostRepCountRef.current;

      let ghostT = 0; // 0 = rest, 1 = full target
      let ghostOpacity = 0.72;
      let isHolding = false;

      if (infPhase === "ready" || infPhase === "idle") {
        if (repsDone === 0) {
          // Teaching animation: oscillate 0→1→0 so patient sees the movement
          ghostT = 0.5 + 0.5 * Math.sin(now / 3200);
          ghostOpacity = 0.65;
        } else if (readyElapsedS < 5) {
          // Between reps: ghost dims at rest
          ghostT = 0; ghostOpacity = 0.18 + 0.08 * Math.sin(now / 900);
        } else {
          // Encouragement ramp after 5s rest: ghost rises to invite next rep
          ghostT = Math.min(1, (readyElapsedS - 5) / 6);
          ghostOpacity = 0.72;
        }
      } else if (infPhase === "lifting") {
        ghostT = 1; ghostOpacity = 0.72; // ghost at target: "get here"
      } else if (infPhase === "top" || infPhase === "holding") {
        ghostT = 1; ghostOpacity = 0.88; isHolding = true;
      } else if (infPhase === "lowering") {
        // Pulse between 40% and 75% to signal "come back down"
        ghostT = 0.4 + 0.35 * Math.sin(now / 800); ghostOpacity = 0.72;
      } else if (infPhase === "complete" || infPhase === "bottom") {
        ghostT = 1; ghostOpacity = 1.0;
      } else {
        ghostT = 1; ghostOpacity = 0.6;
      }

      // ── Phase badge ───────────────────────────────────────────────────────
      if (infPhase === "holding" || infPhase === "top") {
        setGhostPhase("holding");
        setGhostHoldMs(holdRem !== null ? Math.max(0, holdTotal - holdRem) : 0);
      } else if (infPhase === "ready" && repsDone === 0) setGhostPhase("demo");
      else if (infPhase === "complete") setGhostPhase("rep_complete");
      else { setGhostPhase("attempt"); setGhostHoldMs(0); }

      // ── Phase transition log ──────────────────────────────────────────────
      if (infPhase !== ghostPrevPhaseRef.current) {
        if (infPhase === "ready") ghostReadyStartRef.current = now;
        const entry: GhostLogEntry = {
          id: `${now}-${Math.random().toString(36).slice(2,5)}`,
          time: new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2 }),
          phase: infPhase, score: Math.round(score * 100), rep: repsDone,
          detail: `${ghostPrevPhaseRef.current} → ${infPhase} | score=${Math.round(score*100)}% rep=${repsDone} hold=${holdRem !== null ? Math.round(holdRem)+"ms" : "n/a"}`,
        };
        ghostPrevPhaseRef.current = infPhase;
        ghostLogRef.current = [entry, ...ghostLogRef.current].slice(0, 80);
        ghostSetLogRef.current?.([...ghostLogRef.current]);
      }

      // ── Colour: blue → green as ghostT goes 0 → 1 ────────────────────────
      const r = Math.floor(96  + (74  - 96)  * ghostT);
      const g = Math.floor(165 + (222 - 165) * ghostT);
      const b = Math.floor(250 + (128 - 250) * ghostT);
      const col = `rgba(${r},${g},${b},${ghostOpacity})`;

      // ── Core arm drawing: shoulder → elbow → wrist ────────────────────────
      // All positions computed from shoulder anchor + fixed direction vectors.
      // No other landmarks involved. Size from frozen shoulderWidth only.
      const drawArm = (
        shX: number, shY: number, // shoulder pixel position (anchor)
        dX: number, dY: number,   // interpolated direction (normalised)
      ) => {
        const dm = Math.sqrt(dX*dX + dY*dY) || 1;
        const nx = dX/dm; const ny = dY/dm;
        const elX = shX + nx * upperArmPx;
        const elY = shY + ny * upperArmPx;
        const wrX = elX + nx * foreArmPx;
        const wrY = elY + ny * foreArmPx;

        ctx.setLineDash([9, 5]);
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(elX, elY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(elX, elY); ctx.lineTo(wrX, wrY); ctx.stroke();
        ctx.setLineDash([]);

        for (const [px, py, r2] of [[shX, shY, 9], [elX, elY, 8], [wrX, wrY, 7]] as [number,number,number][]) {
          ctx.beginPath(); ctx.arc(px, py, r2, 0, Math.PI*2);
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.stroke();
        }
      };

      // ── Fixed direction vectors per exercise type ─────────────────────────
      // REST direction: arm hangs straight down along torso
      // Canvas Y increases downward, so rest = (small_x, positive_y)
      // TARGET direction: depends on exercise
      // Flexion target:   arm sweeps forward and UP → (slight_x, -1)
      // Abduction target: arm sweeps OUT sideways  → (±1, slight_y)
      //
      // ghostT interpolates REST → TARGET linearly.
      // Vectors are normalised inside drawArm so magnitudes don't matter.

      if (isFlexion || isAbduction) {
        const restDX = 0.12; // slight outward lean at rest (natural arm hang)
        const restDY = 1.0;  // straight down

        const tgtDX = isFlexion ? 0.06 : 1.0;
        const tgtDY = isFlexion ? -1.0 : 0.04;

        const dX = restDX + (tgtDX - restDX) * ghostT;
        const dY = restDY + (tgtDY - restDY) * ghostT;

        if (isRight && rsVis) drawArm(rsLm.x * W, rsLm.y * H,  dX, dY);
        if (isLeft  && lsVis) drawArm(lsLm.x * W, lsLm.y * H, -dX, dY);

      } else if (isKnee) {
        // ── Knee extension: hip anchor → leg extends forward ────────────────
        // Use hip landmarks as anchor (seated exercise).
        // Lower body landmarks: 23=L_hip 24=R_hip 25=L_knee 26=R_knee
        const lhLm = lms[23]; const rhLm = lms[24];
        const lkLm = lms[25]; const rkLm = lms[26];
        const hipVis = (lm: typeof lhLm) => !!lm && (lm.visibility ?? 1) > 0.25;

        // Knee segment length from hip→knee if visible, else estimate from sw
        const kneeLenR = (hipVis(rhLm) && hipVis(rkLm))
          ? Math.sqrt(Math.pow((rkLm!.x - rhLm!.x)*W, 2) + Math.pow((rkLm!.y - rhLm!.y)*H, 2))
          : upperArmPx;
        const kneeLenL = (hipVis(lhLm) && hipVis(lkLm))
          ? Math.sqrt(Math.pow((lkLm!.x - lhLm!.x)*W, 2) + Math.pow((lkLm!.y - lhLm!.y)*H, 2))
          : upperArmPx;
        const shinLen = foreArmPx;

        // Rest: lower leg hangs down from knee. Target: leg extends forward.
        const kRestDX = 0.1; const kRestDY = 1.0;
        const kTgtDX  = 0.85; const kTgtDY = 0.1;
        const kdX = kRestDX + (kTgtDX - kRestDX) * ghostT;
        const kdY = kRestDY + (kTgtDY - kRestDY) * ghostT;
        const kdm = Math.sqrt(kdX*kdX + kdY*kdY) || 1;
        const knx = kdX/kdm; const kny = kdY/kdm;

        const drawLeg = (
          hipX: number, hipY: number,
          kneeX: number, kneeY: number,
          legLen: number, flipX: number
        ) => {
          // Thigh: hip to knee (drawn on detected positions — thigh doesn't move in knee ext)
          ctx.setLineDash([9, 5]); ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
          ctx.setLineDash([]);
          // Shin: knee → extended position (animated by ghostT)
          const shX2 = kneeX + knx * flipX * legLen;
          const shY2 = kneeY + kny * shinLen;
          ctx.setLineDash([9, 5]); ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(shX2, shY2); ctx.stroke();
          ctx.setLineDash([]);
          for (const [px, py] of [[hipX, hipY], [kneeX, kneeY], [shX2, shY2]]) {
            ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI*2);
            ctx.fillStyle = col; ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.stroke();
          }
        };

        if (isRight && hipVis(rhLm) && hipVis(rkLm)) {
          drawLeg(rhLm!.x*W, rhLm!.y*H, rkLm!.x*W, rkLm!.y*H, kneeLenR, 1);
        }
        if (isLeft && hipVis(lhLm) && hipVis(lkLm)) {
          drawLeg(lhLm!.x*W, lhLm!.y*H, lkLm!.x*W, lkLm!.y*H, kneeLenL, -1);
        }

      } else if (isSTS) {
        // ── Sit to Stand: show body rising ───────────────────────────────────
        const lhLm = lms[23]; const rhLm = lms[24];
        const hVis = (lm: typeof lhLm) => !!lm && (lm.visibility ?? 1) > 0.25;

        if (hVis(lhLm) && hVis(rhLm)) {
          const hipMidX = (lhLm!.x + rhLm!.x) * 0.5 * W;
          const hipMidY = (lhLm!.y + rhLm!.y) * 0.5 * H;
          const riseLen = ghostSmoothedTorso.current * H * ghostT;
          const arrowTipY = hipMidY - riseLen * 0.8;

          ctx.setLineDash([9, 5]); ctx.lineWidth = 8; ctx.strokeStyle = col; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(hipMidX, hipMidY); ctx.lineTo(hipMidX, arrowTipY); ctx.stroke();
          ctx.setLineDash([]);

          // Arrowhead
          ctx.beginPath();
          ctx.moveTo(hipMidX, arrowTipY);
          ctx.lineTo(hipMidX - 16, arrowTipY + 20);
          ctx.lineTo(hipMidX + 16, arrowTipY + 20);
          ctx.closePath();
          ctx.fillStyle = col; ctx.fill();

          // Joint dot at hip
          ctx.beginPath(); ctx.arc(hipMidX, hipMidY, 9, 0, Math.PI*2);
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.stroke();
        }
      }

      // ── ROM score ring — top-left corner ─────────────────────────────────
      // Mirror of hold ring (top-right). Shows patient's current ROM as a
      // percentage of their target. Orange→yellow→green as score improves.
      // Dimmed during ready phase; full opacity during lifting/holding.
      {
        const romPct = score; // 0–1 from elevation formula above
        const romRadius = Math.min(W, H) * 0.13;
        const romStrokeW = romRadius * 0.14;
        const romCx = romRadius + romStrokeW * 2 + 12; // top-left
        const romCy = romRadius + romStrokeW * 2 + 12;
        const isActivePhase = infPhase === "lifting" || infPhase === "holding" || infPhase === "lowering";
        const ringOpacity = isActivePhase ? 1.0 : 0.35;

        // Colour: orange (0%) → yellow (50%) → green (100%)
        const rRom = romPct < 0.5
          ? 210
          : Math.floor(210 + (63 - 210) * ((romPct - 0.5) / 0.5));
        const gRom = romPct < 0.5
          ? Math.floor(100 + (185 - 100) * (romPct / 0.5))
          : Math.floor(185 + (222 - 185) * ((romPct - 0.5) / 0.5));
        const bRom = romPct < 0.5 ? 34 : Math.floor(34 + (128 - 34) * ((romPct - 0.5) / 0.5));
        const ringColor = `rgba(${rRom},${gRom},${bRom},${ringOpacity})`;

        ctx.save();
        ctx.globalAlpha = ringOpacity;

        // Dark backdrop
        ctx.beginPath();
        ctx.arc(romCx, romCy, romRadius + romStrokeW * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,20,0.80)";
        ctx.fill();

        // Track ring
        ctx.beginPath();
        ctx.arc(romCx, romCy, romRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = romStrokeW;
        ctx.lineCap = "round";
        ctx.stroke();

        // Progress arc
        if (romPct > 0) {
          ctx.beginPath();
          ctx.arc(romCx, romCy, romRadius, -Math.PI / 2, -Math.PI / 2 + romPct * Math.PI * 2);
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = romStrokeW;
          ctx.lineCap = "round";
          ctx.stroke();
        }

        // Percentage number — shifted up slightly to make room for phase label
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.font = `800 ${Math.round(romRadius * 0.72)}px system-ui, sans-serif`;
        ctx.fillText(`${Math.round(romPct * 100)}`, romCx, romCy - romRadius * 0.18);

        // Phase label — replaces static "ROM %" text, shows current action
        // Colours match the old DOM badge
        const phaseLabel = (() => {
          if (!sessionQueue.sessionStarted) return "ROM %";
          switch (infPhase) {
            case "lifting":  return "Raise \u2191";
            case "holding":  return "Hold";
            case "lowering": return "Lower \u2193";
            case "ready":    return "Ready";
            case "complete": return "Done \u2713";
            default:         return "ROM %";
          }
        })();
        const phaseLabelColor = (() => {
          switch (infPhase) {
            case "lifting":  return `rgba(124,198,255,${ringOpacity})`;
            case "holding":  return `rgba(74,222,128,${ringOpacity})`;
            case "lowering": return `rgba(251,191,36,${ringOpacity})`;
            case "ready":    return `rgba(155,231,176,${ringOpacity})`;
            case "complete": return `rgba(74,222,128,${ringOpacity})`;
            default:         return `rgba(255,255,255,0.55)`;
          }
        })();
        ctx.fillStyle = phaseLabelColor;
        ctx.font = `700 ${Math.round(romRadius * 0.28)}px system-ui, sans-serif`;
        ctx.fillText(phaseLabel, romCx, romCy + romRadius * 0.42);

        ctx.restore();
      }

      // ── Hold countdown ring — top-right corner ───────────────────────────
      if (isHolding) {
        const holdElapsed = holdRem !== null ? Math.max(0, holdTotal - holdRem) : 0;
        const pct = Math.min(1, holdElapsed / holdTotal);
        const remaining = Math.max(0, Math.ceil((holdTotal - holdElapsed) / 1000));
        const radius = Math.min(W, H) * 0.13;   // smaller than centre ring
        const strokeW = radius * 0.14;
        const cx = W - radius - strokeW * 2 - 12; // top-right, with padding
        const cy = radius + strokeW * 2 + 12;

        // Dark backdrop
        ctx.beginPath();
        ctx.arc(cx, cy, radius + strokeW * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(8,12,20,0.80)';
        ctx.fill();

        // Track ring
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = strokeW;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Progress arc
        ctx.beginPath();
        ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = strokeW;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Countdown number
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(radius * 0.85)}px system-ui, sans-serif`;
        ctx.fillText(String(remaining), cx, cy - radius * 0.08);

        // HOLD label
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `600 ${Math.round(radius * 0.28)}px system-ui, sans-serif`;
        ctx.fillText('HOLD', cx, cy + radius * 0.45);
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
    ghostLastFrameRef.current = null;
    ghostFrameInitRef.current = false;
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

      {/* ── ROW 1: COMPACT SESSION BAR ── */}
      <div style={{
        background: "#1a2040",
        borderRadius: 12,
        padding: isMobile ? "12px 14px" : "10px 18px",
        border: "1px solid rgba(255,255,255,0.08)",
        marginBottom: 12,
        display: "flex",
        alignItems: isMobile ? "flex-start" : "center",
        justifyContent: "space-between",
        flexDirection: isMobile ? "column" : "row",
        gap: 10,
      }}>
        {/* Left: Branding + session meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: "white", letterSpacing: -0.4 }}>
              {sessionTitle ?? "Rehably"}
            </div>
            {patientName && (
              <div style={{ fontSize: 11, color: "#aab6d3", marginTop: 1 }}>
                {patientName}
                {" · "}
                <span style={{ color: "#7a88a8" }}>{patientProfile.type.replace(/_/g, " ")}</span>
              </div>
            )}
          </div>
          {/* Stats badges */}
          {combinedQueue.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[
                formatDurationRange(combinedDurationSeconds),
                `${combinedQueue.length} exercise${combinedQueue.length !== 1 ? "s" : ""}`,
                `${combinedTotalReps} reps`,
              ].map(label => (
                <span key={label} style={{
                  padding: "3px 9px", borderRadius: 999,
                  background: "rgba(124,198,255,0.08)", color: "#7cc6ff",
                  fontSize: 11, fontWeight: 600,
                }}>{label}</span>
              ))}
            </div>
          )}
        </div>

        {/* Right: Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {/* AI status dot */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: aiEngineStatus === "ok" ? "#9be7b0" : aiEngineStatus === "error" ? "#ff8f8f" : aiEngineStatus === "checking" ? "#ffcc80" : "#7a88a8",
              boxShadow: aiEngineStatus === "ok" ? "0 0 5px #9be7b0" : aiEngineStatus === "checking" ? "0 0 5px #ffcc80" : "none",
              animation: aiEngineStatus === "checking" ? "pulse 1s infinite" : "none",
            }} />
            <span style={{ fontSize: 11, color: aiEngineStatus === "ok" ? "#9be7b0" : aiEngineStatus === "error" ? "#ff8f8f" : "#7a88a8" }}>
              {aiEngineStatus === "ok" ? "AI Ready" : aiEngineStatus === "error" ? "AI Error" : aiEngineStatus === "checking" ? "Connecting…" : "AI Engine"}
            </span>
          </div>

          {/* Voice toggle */}
          <button onClick={handleVoiceToggle} style={{
            background: voiceOn ? "rgba(100,220,150,0.12)" : "rgba(255,255,255,0.06)",
            color: voiceOn ? "#9be7b0" : "#7a88a8",
            border: "1px solid " + (voiceOn ? "rgba(100,220,150,0.3)" : "rgba(255,255,255,0.1)"),
            borderRadius: 7, padding: "5px 10px",
            fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}>
            {voiceOn ? "🔊 Voice" : "🔇 Muted"}
          </button>

          {/* Pre-session: Test + Begin */}
          {!sessionQueue.sessionStarted && (
            <>
              <button onClick={() => checkAiEngine(false)} style={{
                background: "rgba(124,198,255,0.1)", color: "#7cc6ff",
                border: "1px solid rgba(124,198,255,0.25)", borderRadius: 7,
                padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>
                Test
              </button>
              {combinedQueue.length > 0 && (
                <button
                  onClick={beginCombinedSession}
                  disabled={!canBegin}
                  style={{
                    background: canBegin ? "#9be7b0" : "rgba(155,231,176,0.15)",
                    color: canBegin ? "#08111f" : "#7a88a8",
                    border: "none", borderRadius: 8,
                    padding: "8px 18px", fontSize: 13, fontWeight: 800,
                    cursor: canBegin ? "pointer" : "not-allowed",
                    letterSpacing: 0.3,
                  }}
                >
                  Begin Session
                </button>
              )}
            </>
          )}

          {/* In-session: progress + end/reset */}
          {sessionQueue.sessionStarted && (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "rgba(155,231,176,0.08)",
                border: "1px solid rgba(155,231,176,0.2)",
                borderRadius: 8, padding: "5px 12px",
              }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#9be7b0", boxShadow: "0 0 5px #9be7b0", animation: "pulse 2s infinite" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#9be7b0" }}>In Progress</span>
                <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: "white", letterSpacing: 1 }}>{sessionTimer}</span>
              </div>
              <span style={{ fontSize: 12, color: "#7a88a8" }}>
                {sessionQueue.queueIndex + 1}&thinsp;/&thinsp;{sessionQueue.getActiveQueue().length}
              </span>
              <button onClick={endSession} style={{
                background: "rgba(124,198,255,0.1)", color: "#7cc6ff", padding: "6px 12px",
                borderRadius: 7, border: "1px solid rgba(124,198,255,0.2)", cursor: "pointer", fontSize: 12, fontWeight: 600,
              }}>End</button>
              <button onClick={resetSession} style={{
                background: "rgba(255,255,255,0.06)", color: "#aab6d3", padding: "6px 12px",
                borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12,
              }}>Reset</button>
            </>
          )}
        </div>
      </div>

      {/* ── ROW 2: MAIN GRID ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1.1fr) minmax(0,0.9fr)",
        gap: 16,
        alignItems: "start",
        marginBottom: 16,
      }}>

        {/* LEFT: Framing Intelligence Bar + Camera */}
        <div>

          {/* ── FRAMING INTELLIGENCE BAR ── */}
          <div style={{
            marginBottom: 8,
            padding: "9px 14px",
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 600,
            background: framingPanelState.tone === "good"
              ? "rgba(63,185,80,0.10)"
              : framingPanelState.tone === "critical"
              ? "rgba(248,81,73,0.10)"
              : "rgba(210,153,34,0.10)",
            border: `1px solid ${
              framingPanelState.tone === "good" ? "rgba(63,185,80,0.30)"
              : framingPanelState.tone === "critical" ? "rgba(248,81,73,0.30)"
              : "rgba(210,153,34,0.30)"
            }`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            {/* Status dot */}
            <div style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: framingPanelState.tone === "good" ? "#3fb950"
                : framingPanelState.tone === "critical" ? "#f85149" : "#d29922",
              boxShadow: `0 0 6px ${
                framingPanelState.tone === "good" ? "#3fb950"
                : framingPanelState.tone === "critical" ? "#f85149" : "#d29922"
              }`,
              animation: framingPanelState.evaluating ? "pulse 1s infinite" : "none",
            }} />
            {/* Message */}
            <span style={{
              flex: 1,
              color: framingPanelState.tone === "good" ? "#9be7b0"
                : framingPanelState.tone === "critical" ? "#ff8f8f" : "#ffcc80",
            }}>
              {framingPanelState.message}
            </span>
            {/* Severity chip */}
            {framingPanelState.severity && framingPanelState.severity !== "ok" && (
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 999, fontWeight: 700, flexShrink: 0,
                background: framingPanelState.tone === "good" ? "rgba(63,185,80,0.15)"
                  : framingPanelState.tone === "critical" ? "rgba(248,81,73,0.15)"
                  : "rgba(210,153,34,0.15)",
                color: framingPanelState.tone === "good" ? "#3fb950"
                  : framingPanelState.tone === "critical" ? "#f85149" : "#d29922",
              }}>
                {framingPanelState.severity}
              </span>
            )}
          </div>

          {/* ── CAMERA CARD ── */}
          <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ position: "relative" }}>
              <CameraViewport ref={cameraRef} onVideoReady={handleCameraReady} onCameraStop={handleCameraStop} showStartButton={false} />
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <PoseCanvasOverlay frame={inferenceLoop.frame} />
              </div>
              {/* Ghost silhouette canvas — layered on top of pose skeleton */}
              <canvas
                ref={ghostCanvasRef}
                width={640} height={480}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: "block", opacity: sessionQueue.sessionStarted ? 1 : 0, transition: "opacity 0.5s ease" }}
              />
            </div>
            {inferenceLoop.engineError && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(255,100,100,0.1)", color: "#ff8f8f", fontSize: 13 }}>
                {inferenceLoop.engineError}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Coaching + Camera Sees */}
        <div style={{ display: "grid", gap: 12 }}>

          {/* ── LIVE COACHING CARD ── */}
          <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Live Coaching</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(124,198,255,0.12)", color: "#7cc6ff", fontSize: 11, fontWeight: 700 }}>
                  {formatPhase(inferenceLoop.phase)}
                </span>
                <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "white", fontSize: 11, fontWeight: 700 }}>
                  {inferenceLoop.repCount}/{currentPrescription?.repTarget ?? 0} reps
                </span>
                {inferenceLoop.holdRemainingMs !== null && inferenceLoop.phase === "holding" && (
                  <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(100,220,150,0.12)", color: "#9be7b0", fontSize: 11, fontWeight: 700 }}>
                    Hold {Math.max(1, Math.ceil(inferenceLoop.holdRemainingMs / 1000))}s
                  </span>
                )}
              </div>
            </div>

            {/* Exercise title + instructions */}
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, marginBottom: 8, lineHeight: 1.2 }}>
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
              display: "flex", alignItems: "center", gap: 10,
            }}>
              {coachingPanelState.isThinking ? (
                <div style={{ color: "#7a88a8", fontSize: 13, fontStyle: "italic" }}>Thinking…</div>
              ) : coachingPanelState.message ? (
                <>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: coachingPanelState.tone === "corrective" ? "#ffcc80" :
                      coachingPanelState.tone === "urgent" ? "#ff8f8f" :
                      coachingPanelState.tone === "encouraging" ? "#9be7b0" : "#7cc6ff",
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

          {/* ── CAMERA SEES (secondary observations) ── */}
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

      {/* ── ROW 3: SESSION DETAILS + PERFORMANCE ── */}
      {combinedQueue.length > 0 && (
        <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
              Session Details
            </div>
            {combinedGoal && (
              <div style={{ fontSize: 12, color: "#7a88a8" }}>{combinedGoal}</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {combinedQueue.map((item, i) => {
              const p = item.prescription as any;
              const romTarget = p.romTargetDegrees ?? p.romAcceptableMin ?? null;
              const romNorm = p.romNormDegrees ?? null;
              const encourage = p.encourageThreshold ?? null;

              const isActiveExercise = sessionQueue.sessionStarted && sessionQueue.queueIndex === i;
              const isPastExercise = sessionQueue.sessionStarted && sessionQueue.queueIndex > i;
              const repsCompleted = isActiveExercise
                ? inferenceLoop.repCount
                : isPastExercise ? item.prescription.repTarget : 0;
              const peakMetrics = exercisePeakMetricsRef.current[i] ?? [];
              const avgPeak = peakMetrics.length > 0
                ? Math.round(peakMetrics.reduce((a, b) => a + b, 0) / peakMetrics.length)
                : null;
              const completionRate = item.prescription.repTarget > 0 ? repsCompleted / item.prescription.repTarget : 0;
              const showPerformance = sessionQueue.sessionStarted && (isActiveExercise || isPastExercise);

              // Quality badge
              let qualityLabel = "";
              let qualityColor = "#7a88a8";
              let qualityBg = "rgba(255,255,255,0.05)";
              if (isPastExercise || (isActiveExercise && repsCompleted > 0)) {
                if (completionRate >= 0.9) { qualityLabel = "Good"; qualityColor = "#3fb950"; qualityBg = "rgba(63,185,80,0.12)"; }
                else if (completionRate >= 0.6) { qualityLabel = "Partial"; qualityColor = "#d29922"; qualityBg = "rgba(210,153,34,0.12)"; }
                else if (repsCompleted > 0) { qualityLabel = "Below Target"; qualityColor = "#f85149"; qualityBg = "rgba(248,81,73,0.12)"; }
              }

              return (
                <div key={i} style={{
                  padding: "12px 14px", borderRadius: 10,
                  background: isActiveExercise ? "rgba(124,198,255,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isActiveExercise ? "rgba(124,198,255,0.2)" : "rgba(255,255,255,0.05)"}`,
                }}>
                  {/* Exercise header: number + name + active badge + quality */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                        background: isActiveExercise ? "rgba(124,198,255,0.2)" : "rgba(124,198,255,0.1)",
                        color: "#7cc6ff", fontSize: 11, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{i + 1}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{item.displayName}</span>
                      {isActiveExercise && (
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(124,198,255,0.15)", color: "#7cc6ff", fontWeight: 700 }}>Active</span>
                      )}
                    </div>
                    {qualityLabel && (
                      <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 999, background: qualityBg, color: qualityColor, fontWeight: 700, flexShrink: 0 }}>
                        {qualityLabel}
                      </span>
                    )}
                  </div>

                  {/* Two-column: Target | Result */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: showPerformance && !isMobile ? "1fr 1fr" : "1fr",
                    gap: isMobile ? 8 : 16,
                  }}>
                    {/* Target prescription */}
                    <div>
                      <div style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 5 }}>Target</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#aab6d3" }}>
                          {item.prescription.repTarget} reps
                          {item.prescription.hold.required ? ` · ${item.prescription.hold.durationMs / 1000}s hold` : ""}
                        </span>
                        {romTarget !== null && (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(210,153,34,0.12)", color: "#d29922", fontWeight: 600 }}>
                            {romTarget}°
                          </span>
                        )}
                        {romNorm !== null && (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(124,198,255,0.08)", color: "#7cc6ff" }}>
                            Norm {romNorm}°
                          </span>
                        )}
                        {encourage !== null && (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(63,185,80,0.12)", color: "#3fb950", fontWeight: 600 }}>
                            Push {encourage}°
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Performance result (during / after session) */}
                    {showPerformance && (
                      <div>
                        <div style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 5 }}>Result</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{
                            fontSize: 13, fontWeight: 700,
                            color: completionRate >= 0.9 ? "#9be7b0" : completionRate >= 0.6 ? "#ffcc80" : repsCompleted > 0 ? "#ff8f8f" : "#7a88a8",
                          }}>
                            {repsCompleted}/{item.prescription.repTarget}
                          </span>
                          {avgPeak !== null && (
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(124,198,255,0.08)", color: "#7cc6ff" }}>
                              Avg {avgPeak}°
                            </span>
                          )}
                          {isActiveExercise && inferenceLoop.phase !== "ready" && (
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(167,139,250,0.12)", color: "#a78bfa", fontWeight: 700 }}>
                              {formatPhase(inferenceLoop.phase)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SESSION SELECTOR (local builder mode only — hidden when prescription loaded) ── */}
      {!prescriptionQueue?.length && (
      <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: selectorCollapsed ? 0 : 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Session Selector</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: 16 }}>
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

      {/* ── DEVELOPER TOOLS ── */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 10, color: "#484f58", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 6, paddingLeft: 2 }}>
          Developer Tools
        </div>
      </div>

      {/* ── GHOST INTELLIGENCE LOG ── */}
      <div style={{ background: "#0a0f1e", borderRadius: 12, border: "1px solid rgba(167,139,250,0.2)", overflow: "hidden", marginBottom: 8 }}>
        <div onClick={() => setGhostLogOpen(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "rgba(167,139,250,0.05)", borderBottom: ghostLogOpen ? "1px solid rgba(167,139,250,0.1)" : "none", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.8 }}>Ghost Intelligence</span>
            <span style={{ fontSize: 11, color: "#7a88a8" }}>{ghostLog.length} transitions</span>
            {sessionQueue.sessionStarted && (
              <span style={{ fontSize: 11, color: "#a78bfa" }}>phase: {ghostPhaseInfRef.current} | score: {Math.round(ghostScore*100)}% | rep: {inferenceLoop.repCount}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={e => { e.stopPropagation(); const text = ghostLog.map(e => `[${e.time}] [${e.phase.toUpperCase()}] rep=${e.rep} score=${e.score}% | ${e.detail}`).join("\n"); copyToClipboard(text); }} style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 6, padding: "3px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Copy Log</button>
            <button onClick={e => { e.stopPropagation(); ghostLogRef.current=[]; setGhostLog([]); }} style={{ background: "rgba(255,255,255,0.05)", color: "#7a88a8", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Clear</button>
            <span style={{ color: "#7a88a8", fontSize: 12 }}>{ghostLogOpen ? "▲" : "▼"}</span>
          </div>
        </div>
        {ghostLogOpen && (
          <div style={{ maxHeight: 280, overflowY: "auto", padding: 10, display: "grid", gap: 3 }}>
            {ghostLog.length === 0 ? (
              <div style={{ color: "#7a88a8", fontSize: 12, padding: "8px 4px" }}>No transitions yet. Start a session to see ghost phase changes.</div>
            ) : ghostLog.map(entry => {
              const phaseColors: Record<string, string> = { lifting: "#7cc6ff", top: "#4ade80", holding: "#4ade80", lowering: "#fbbf24", ready: "#a78bfa", complete: "#9be7b0", bottom: "#9be7b0", idle: "#7a88a8", unknown: "#7a88a8" };
              const col = phaseColors[entry.phase] ?? "#aab6d3";
              return (
                <div key={entry.id} style={{ background: `${col}10`, borderRadius: 6, padding: "5px 10px", border: `1px solid ${col}22` }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", flexShrink: 0 }}>{entry.time}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: `${col}22`, color: col, flexShrink: 0 }}>{entry.phase.toUpperCase()}</span>
                    <span style={{ fontSize: 10, color: "#7a88a8", flexShrink: 0 }}>rep {entry.rep}</span>
                    <span style={{ fontSize: 10, color: col, flexShrink: 0 }}>{entry.score}%</span>
                    <span style={{ fontSize: 11, color: "#aab6d3", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.detail}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── REP CYCLE DEBUG LOG ── */}
      <div style={{ background: "#0a0f1e", borderRadius: 12, border: "1px solid rgba(74,222,128,0.2)", marginBottom: 8 }}>
        <div onClick={() => setRepCycleOpen(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "rgba(74,222,128,0.04)", borderBottom: repCycleOpen ? "1px solid rgba(74,222,128,0.1)" : "none", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.08em" }}>REP CYCLE LOG</span>
            <span style={{ fontSize: 11, color: "#7a88a8" }}>{repCycleLog.length} events</span>
            <span style={{ fontSize: 10, color: "#4ade80", opacity: 0.7 }}>metric · thresh · physioTarget · encourage · romMin · romNorm</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={e => { e.stopPropagation(); const text = repCycleLog.map(e => `[${e.time}] [${e.event}] rep=${e.repCount} | ${e.detail}`).join("\n"); copyToClipboard(text); }} style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 6, padding: "3px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Copy</button>
            <button onClick={e => { e.stopPropagation(); repCycleLogRef.current=[]; setRepCycleLog([]); }} style={{ background: "rgba(255,255,255,0.05)", color: "#7a88a8", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Clear</button>
            <span style={{ color: "#7a88a8", fontSize: 12 }}>{repCycleOpen ? "▲" : "▼"}</span>
          </div>
        </div>
        {repCycleOpen && (
          <div style={{ maxHeight: 400, overflowY: "auto", padding: 10, display: "grid", gap: 4 }}>
            {repCycleLog.length === 0 ? (
              <div style={{ color: "#7a88a8", fontSize: 12, padding: "8px 4px" }}>No rep events yet. Begin a session and perform reps.</div>
            ) : repCycleLog.map(entry => {
              const isHold = entry.event === "HOLD START";
              const col = isHold ? "#4ade80" : entry.event === "REP COMPLETE" ? "#7cc6ff" : "#ff8f8f";
              const metricAboveTarget = entry.metricValue !== null && entry.targetThreshold !== null && entry.metricValue >= entry.targetThreshold;
              const metricAboveEncourage = entry.encourageThreshold !== null && entry.metricValue !== null && entry.metricValue >= entry.encourageThreshold;
              return (
                <div key={entry.id} style={{ background: `${col}10`, borderRadius: 6, padding: "6px 10px", border: `1px solid ${col}20` }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", flexShrink: 0 }}>{entry.time}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: col, padding: "1px 6px", borderRadius: 4, background: `${col}20`, flexShrink: 0 }}>{entry.event}</span>
                    <span style={{ fontSize: 10, color: "#7a88a8", flexShrink: 0 }}>rep {entry.repCount}</span>
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" as const }}>
                    {/* Metric vs target */}
                    <span style={{ fontSize: 11, color: metricAboveTarget ? "#4ade80" : "#ff8f8f" }}>
                      metric: <strong>{entry.metricValue?.toFixed(1) ?? "?"}°</strong>
                    </span>
                    <span style={{ fontSize: 11, color: "#7cc6ff" }}>
                      thresh: <strong>{entry.targetThreshold?.toFixed(1) ?? "?"}°</strong>
                    </span>
                    {/* Physio override indicator */}
                    <span style={{ fontSize: 11, color: entry.romTargetDegrees !== null ? "#d29922" : "#484f58" }}>
                      physio: <strong>{entry.romTargetDegrees !== null ? `${entry.romTargetDegrees}°` : "population"}</strong>
                    </span>
                    {/* Encourage threshold */}
                    <span style={{ fontSize: 11, color: entry.encourageThreshold !== null ? (metricAboveEncourage ? "#3fb950" : "#a78bfa") : "#484f58" }}>
                      push-to: <strong>{entry.encourageThreshold !== null ? `${entry.encourageThreshold}°` : "—"}</strong>
                      {metricAboveEncourage && <span style={{ color: "#3fb950", marginLeft: 4 }}>✓ reached</span>}
                    </span>
                    {/* Population reference values */}
                    <span style={{ fontSize: 11, color: "#ffcc80" }}>romMin: <strong>{entry.romAcceptableMin ?? "?"}°</strong></span>
                    <span style={{ fontSize: 11, color: "#a78bfa" }}>norm: <strong>{entry.romNormDegrees ?? "?"}°</strong></span>
                  </div>
                </div>
              );
            })}
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
          onViewLogs={() => {
            setSessionSummary(null);
            // Overlay dismissed — debug panels are now visible underneath
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
