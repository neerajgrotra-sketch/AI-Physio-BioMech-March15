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

import PositionGuideOverlay, { POSITION_ICON, POSITION_COLOR } from "@/components/session/PositionGuideOverlay";
import { positioningSteps } from "@/lib/positioning/positioningSteps";
import { drawArmLabel, drawReachGuide, reachLineY, handTargetPoint, drawHandTarget, handOffset, medianOffset, targetFromOffset } from "@/lib/pose/reachGuide";
import { drawExampleCard } from "@/lib/pose/exampleCard";
import { RepCoach } from "@/lib/coaching/repCoach";
import { DemoNarrator } from "@/lib/coaching/demoNarrator";
import { PresenceTracker, seenInFrame } from "@/lib/session/presence";
import { ReachCheck, AngleBias } from "@/lib/session/reachCheck";
import { PostureLatch } from "@/lib/pose/postureLatch";
import { demoClock, BETWEEN_REPS_REST_S, DEMO_CYCLE_S } from "@/lib/pose/ghostAnimator";
import { maxPlaneNow, pathSidewaysNow, setMaxPlaneDeg } from "@/lib/interpreter/movementInterpreter";
import { setHoldSlipMs } from "@/lib/interpreter/repStateMachine";
import { versionLabel, APP_VERSION, APP_COMMIT, APP_BRANCH } from "@/lib/app/version";
import { assignmentCode } from "@/lib/app/assignment";
import { exerciseSeconds } from "@/lib/app/sessionDuration";
import { liftCaption, targetPhrase } from "@/lib/coaching/plainHeight";
import { resumePlan, awayState, type AwayState, type SessionProgress } from "@/lib/session/resume";
import { resolveCoachSettings, orbitYaw } from "@/lib/coach/coachSettings";
import { effectiveTolerances } from "@/lib/coach/patientTolerances";
import { setRestSettleMs } from "@/lib/interpreter/restEstimate";
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
import { getGhostConfig } from "@/lib/pose/ghostConfig";
import { computeGhostAnim } from "@/lib/pose/ghostAnimator";
import { dispatchGhostDraw } from "@/lib/pose/ghostDrawers";

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

type LogLevel = "info" | "success" | "warning" | "error" | "api_out" | "api_in" | "FRAMING_VOICE" | "FRAMING_SNAP";

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
  globalDebugLog = [entry, ...globalDebugLog].slice(0, 1500); // ~10 min with the 1 s TRACE
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
        promptSnippet = (body.prompt ?? body.messages?.[0]?.content ?? "").slice(0, 200);
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
            writeDebugLog("api_in", "API", `← Response received${data.ms ? ` (${data.ms} ms, ${data.model ?? "?"})` : ""}`, text);
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
  api_in:        { bg: "rgba(100,220,200,0.08)", color: "#6ee7d4",  label: "IN"     },
  FRAMING_VOICE: { bg: "rgba(210,153,34,0.10)",  color: "#ffcc80",  label: "FRAME" },
  FRAMING_SNAP:  { bg: "rgba(108,99,255,0.10)",   color: "#a78bfa",  label: "FRAME" }
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
    partial?: boolean;
    paused?: boolean;
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
          <div style={{ fontSize: 40, marginBottom: 12 }}>{summary.partial ? "⏹️" : "🎉"}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#e6edf3", marginBottom: 6 }}>
            {summary.partial
              ? `Session Ended${patientName ? `, ${patientName.split(" ")[0]}` : ""}`
              : `Session Complete${patientName ? `, ${patientName.split(" ")[0]}!` : "!"}`}
          </div>
          {summary.partial && (
            <div style={{ fontSize: 13, color: "#d29922", marginBottom: 4 }}>
              {summary.paused
                ? "Your progress is saved. Open your link again today to carry on where you left off."
                : "Completed exercises have been saved."}
            </div>
          )}
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
  /** Previous session summary fetched server-side — used for greeting */
  previousSession?: { mobilityScore: number; sessionTitle: string; claudeSummary: string };
  /** Saved status and progress of this assignment, to offer resuming it. */
  savedStatus?: string | null;
  savedProgress?: SessionProgress | null;
  /** The clinic's coach settings from the Coach Lab (resolved and clamped here). */
  coachSettings?: unknown;
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

export default function SessionRunner({ prescriptionQueue, restBoundaries: fullBoundaries = [], sessionTitle, initialPatientProfile, prescriptionId, patientId, patientName, previousSession, savedStatus, savedProgress, coachSettings: savedCoach }: SessionRunnerProps = {}) {
  const { sessions } = useSessionLibrary();
  const exercises = ACTIVE_EXERCISE_LIBRARY;
  const cameraRef = useRef<CameraViewportHandle | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null); // stored on camera ready for pause/resume
  const sessionStartedAtMsRef = useRef<number | null>(null);
  // Ghost silhouette refs
  const ghostCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  // The guide's own panel, left of the camera (the 10-foot layout): the
  // guide figure is drawn here for forward raises facing the camera.
  const guideCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const [guideInPanel, setGuideInPanel] = useState(false);
  // The words of the spoken greeting, shown in the coach panel while it plays.
  const [greetingCaption, setGreetingCaption] = useState<string | null>(null);
  const guideInPanelRef = useRef(false);
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
  const ghostRepCountRef   = useRef<number>(0);   // tracks reps to distinguish first-rep ready vs between-rep ready
  const ghostPrevPhaseRef  = useRef<string>("");  // detect phase transitions for debug log
  const ghostReadyStartRef = useRef<number>(0);
  const lastTraceMsRef = useRef<number>(0);
  const repCoachRef = useRef(new RepCoach());  // coaching through the rep
  // The clinic's coach settings (Coach Lab in /admin; lib/coach/coachSettings.ts).
  const coach = useMemo(() => resolveCoachSettings(savedCoach), [savedCoach]);
  const coachRef = useRef(coach);
  coachRef.current = coach;
  useEffect(() => {
    repCoachRef.current.configure({
      stallMs: coach.stallSeconds * 1000,
      wrongArmRiseDeg: coach.wrongArmRiseDeg,
      wrongArmPersistMs: coach.wrongArmSeconds * 1000,
      restTauMs: coach.restSettleSeconds * 1000,
    });
    setRestSettleMs(coach.restSettleSeconds * 1000);
  }, [coach]);
  const narratorRef = useRef(new DemoNarrator()); // the guide talks while demonstrating
  // Where this patient's hand is when a rep reaches the target (wrist offset
  // from the shoulder, recorded at each crossing): the hand circle moves there.
  const handSamplesRef = useRef<Array<{ dx: number; dy: number }>>([]);
  // The range check before each arm's first forward raise (lib/session/reachCheck.ts).
  const reachRef = useRef<ReachCheck | null>(null);
  const reachDoneRef = useRef<Set<string>>(new Set());     // arms already checked this session
  const reachRangeRef = useRef<Record<number, number>>({}); // queue index -> comfortable range (measured degrees)
  const angleBiasRef = useRef(new AngleBias());            // 3D minus measured near the top, for the hand circle
  const deferredIntroRef = useRef(false);                  // the exercise intro waits for the range check
  const sessionDoneRef = useRef(false);                    // all exercises finished: no more coaching
  // A range check is still to come for the current exercise (before its first rep).
  const reachDue = () => {
    const p = sessionQueue.getActivePrescription();
    const side = p?.side === "left" ? "left" : p?.side === "right" ? "right" : null;
    return !!p && !!side && (p.id ?? "").startsWith("shoulder_flexion") && coachRef.current.reachCheckOn &&
      !runIndexesRef.current && !reachDoneRef.current.has(side) && !sessionDoneRef.current;
  };
  const prevMetricForHandRef = useRef<number | null>(null);
  // The next exercise's spoken intro waits until the patient is placed (the
  // owner's run: "raise your left arm" played over the positioning voice).
  const pendingIntroRef = useRef(false);
  const guideYawRef = useRef(90);                 // the guide figure's current viewing angle
  const postureLatchRef = useRef<PostureLatch | null>(null); // steady seated / standing for the guide
  const ghostPhaseSeenRef = useRef<string>("");   // phase timing for the ghost
  const ghostLowerStartRef = useRef<number>(0);   // when lowering began  // when ready phase started, for animation after wait
  // Transition state — ghostT fades to 0 over 300ms when switching exercises (prevents snapping)
  const ghostTransitionRef = useRef<{ active: boolean; startMs: number; fromGhostT: number }>({
    active: false, startMs: 0, fromGhostT: 0,
  });
  // ghostPhaseRef, ghostStartRef, ghostHoldRef, ghostLowRef, ghostRepRef, ghostHistRef
  // removed — replaced by computeGhostAnim() in ghostAnimator.ts
  const [ghostScore, setGhostScore]         = useState(0);
  const [ghostHoldMs, setGhostHoldMs]       = useState(0);
  const [ghostPhase, setGhostPhase]         = useState<"demo"|"attempt"|"holding"|"rep_complete">("demo");
  const [ghostDemoProgress, setGhostDemoProgress] = useState(0);

  useEffect(() => { patchFetch(); }, []);

  // The AI status light in the header shows the real state from the start.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkAiEngine(true); }, []);

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
  const [expandedExerciseRow, setExpandedExerciseRow] = useState<number | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile>(
  initialPatientProfile ?? createDefaultPatientProfile()
);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [voiceEnabled, setVoiceEnabledState] = useState(true);
  const [selectorCollapsed, setSelectorCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // A screen taller than it is wide (a monitor turned upright, a tablet on a
  // stand): the guide goes above the camera so both use the full width.
  const [isPortrait, setIsPortrait] = useState(false);
  const stacked = isMobile || isPortrait; // guide above the camera
  // Soft pause state — inference stops, camera stays on, timer freezes
  const [isPaused, setIsPaused] = useState(false);
  // End session asks: save and finish later, or finish now.
  const [endDialog, setEndDialog] = useState(false);
  // Walking away (lib/session/resume.ts awayState): when the patient was last
  // seen, and what that means now.
  const lastSeenMsRef = useRef(Date.now());
  // Steady presence (lib/session/presence.ts): stray detections don't count.
  const presenceRef = useRef(new PresenceTracker(Date.now()));
  const frozenLoggedRef = useRef<string | null>(null);
  const [away, setAway] = useState<AwayState>({ kind: "present" });

  // ── SESSION PHASE STATE MACHINE ──────────────────────────────────────────
  // Controls the pre-session sequence:
  //   idle       → patient has not clicked Begin
  //   greeting   → greeting is speaking (camera off)
  //   framing    → camera on, waiting for prerequisites to pass
  //   confirmed  → prerequisites just passed, "Perfect" spoken, 1s pause
  //   running    → exercise is underway
  type SessionPhase = "idle" | "greeting" | "framing" | "confirmed" | "running";
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("idle");
  const sessionPhaseRef = useRef<SessionPhase>("idle");
  const greetingSpokenRef = useRef(false);
  const framingConfirmedRef = useRef(false);
  const prereqWasFailingRef = useRef(false); // tracks transition from fail→pass for auto-advance
  // Rest screen state — shown between protocol blocks
  const [restScreen, setRestScreen] = useState<{ restMs: number; onDone: () => void } | null>(null);
  // Post-session summary state — shown when all exercises complete
  const [sessionSummary, setSessionSummary] = useState<{
    mobilityScore: number;
    exerciseResults: { name: string; successful: number; prescribed: number; failed: number; }[];
    aiSummary: string;
    durationMs: number;
    partial?: boolean;
    paused?: boolean;
  } | null>(null);

  useEffect(() => {
    globalSetDebugLog = setDebugLog;
    return () => { globalSetDebugLog = null; };
  }, []);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsPortrait(window.innerHeight > window.innerWidth * 1.1);
    };
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
  const framingIntelligence = useFramingIntelligence(patientProfile, writeDebugLog as (level: string, category: string, message: string, detail?: string) => void);
  const coachingBrain = useCoachingBrain();
  const patientContext = usePatientContext(patientProfile);

  // Keep patientContext profile in sync when user changes patient type
  useEffect(() => {
    patientContext.updatePatientProfile(patientProfile);
  }, [patientProfile]);

  // Session timer — runs while engine is running and not paused
  const sessionTimer = useSessionTimer(inferenceLoop.engineStatus === "running" && !isPaused && away.kind === "present");

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

 const fullQueue = useMemo(() => {
  if (prescriptionQueue && prescriptionQueue.length > 0) {
    return prescriptionQueue.map((p) => ({
      id: p.id,
      displayName: p.name,
      // The Coach Lab's "other arm may move by" replaces the built-in limit.
      prescription: p.qualityLimits?.maxOppositeArmElevationDeg !== undefined
        ? { ...p, qualityLimits: { ...p.qualityLimits, maxOppositeArmElevationDeg: effectiveTolerances(p.tolerances, resolveCoachSettings(savedCoach)).otherArmAllowanceDeg } }
        : p,
      seconds: exerciseSeconds({ reps: p.repTarget, holdMs: p.hold?.durationMs ?? 2000 }),
      sessionName: sessionTitle ?? "Session",
    }));
  }
  return buildQueueFromSessions(selectedSessions, exercises);
}, [selectedSessions, exercises, prescriptionQueue, sessionTitle, savedCoach]);

  // ── Resuming (lib/session/resume.ts) ───────────────────────────────────
  // The same day, a session left with exercises to go can be continued
  // from the first unfinished one. `runIndexes` maps the run's exercises
  // to their place in the full protocol; `doneIdx` is what is finished.
  const resume = useMemo(
    () => prescriptionId && prescriptionQueue
      ? resumePlan({ status: savedStatus, progress: savedProgress, total: fullQueue.length, now: new Date() })
      : { resumable: false, done: [] as number[], remaining: fullQueue.map((_, i) => i) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [prescriptionId, savedStatus, savedProgress, fullQueue.length]);
  const [runIndexes, setRunIndexes] = useState<number[] | null>(null);
  const runIndexesRef = useRef<number[] | null>(null);
  runIndexesRef.current = runIndexes;
  const combinedQueue = useMemo(
    () => (runIndexes ? runIndexes.map((i) => fullQueue[i]).filter(Boolean) : fullQueue),
    [fullQueue, runIndexes]
  );
  const restBoundaries = useMemo(
    () => runIndexes
      ? fullBoundaries.map((b) => ({ ...b, afterIndex: runIndexes.indexOf(b.afterIndex) })).filter((b) => b.afterIndex >= 0 && b.afterIndex < runIndexes.length - 1)
      : fullBoundaries,
    [fullBoundaries, runIndexes]
  );
  const [doneIdx, setDoneIdx] = useState<number[]>([]);
  const doneIdxRef = useRef<number[]>([]);
  const [pendingBegin, setPendingBegin] = useState(false);
  /** The run's exercise i, as its place in the full protocol. */
  const fullIndexOf = (i: number) => (runIndexesRef.current ? runIndexesRef.current[i] ?? i : i);

  // Save where the patient is (app/api/session/progress: patients are not
  // signed in, so this goes through the server).
  const postProgress = useCallback((status: "in_progress" | "paused" | "completed", done: number[], reason?: string) => {
    if (!prescriptionId || !prescriptionQueue) return;
    void fetch("/api/session/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ sessionId: prescriptionId, status, progress: { done, total: fullQueue.length }, reason }),
    }).then(async (r) => {
      if (r.ok) writeDebugLog("info", "PROGRESS", `Saved: ${status}${reason ? ` (${reason})` : ""}, done ${done.length}/${fullQueue.length}`);
      else writeDebugLog("error", "PROGRESS", `Save failed: HTTP ${r.status}`, await r.text().catch(() => ""));
    }).catch((e) => writeDebugLog("error", "PROGRESS", "Save failed", String(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prescriptionId, prescriptionQueue, fullQueue.length]);

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
  // Per-exercise landmark confidence — snapshotted continuously in feedFrame, locked at exercise complete
  const exerciseLandmarkConfidenceRef = useRef<Record<number, number | null>>({});
  // Rolling snapshot of current confidence — updated every feedFrame tick so we never
  // read a stale/reset value at exercise completion time
  const liveConfidenceSnapshotRef = useRef<number | null>(null);
  // Throttle the FRAMING_SNAP debug log to once every 2s
  const lastFramingSnapMsRef = useRef<number>(0);
  // Per-rep timeline — one entry per rep (success or failure) for movement_timeline jsonb
  type RepTimelineEntry = {
    rep: number; outcome: "success" | "failed"; failureReason: string | null;
    peakRomDeg: number | null; holdMs: number | null; timestampMs: number;
  };
  const exerciseRepTimelineRef = useRef<Record<number, RepTimelineEntry[]>>({});
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
      // Accumulate per-rep timeline entry
      if (!exerciseRepTimelineRef.current[queueIdx]) exerciseRepTimelineRef.current[queueIdx] = [];
      exerciseRepTimelineRef.current[queueIdx].push({
        rep: (exerciseCtx?.repCount ?? 0) + 1,
        outcome: "success",
        failureReason: null,
        peakRomDeg: peakMetric !== null ? Math.round(peakMetric * 10) / 10 : null,
        holdMs: holdDurationMs,
        timestampMs: nowMs,
      });

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
      // Accumulate per-rep timeline entry for failed rep
      const failedQueueIdx = sessionQueue.getActiveQueueIndex?.() ?? 0;
      if (!exerciseRepTimelineRef.current[failedQueueIdx]) exerciseRepTimelineRef.current[failedQueueIdx] = [];
      exerciseRepTimelineRef.current[failedQueueIdx].push({
        rep: exerciseCtx.repCount + 1,
        outcome: "failed",
        failureReason,
        peakRomDeg: inferenceLoop.activeMetricValue !== null ? Math.round(inferenceLoop.activeMetricValue * 10) / 10 : null,
        holdMs: null,
        timestampMs: nowMs,
      });
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
      // Snapshot running confidence average — sampled in ghost rAF tick every frame
      const confNow = framingIntelligence.getLandmarkConfidencePct();
      if (confNow !== null) liveConfidenceSnapshotRef.current = confNow;
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
    onExerciseStarted: (nowMs: number) => {
      // Suppress coaching intro during framing phase — greeting already covered
      // the protocol. The framing confirmation auto-advance fires this again
      // once prerequisites are met.
      if (sessionPhaseRef.current === "framing" || sessionPhaseRef.current === "greeting") {
        writeDebugLog("info", "COACHING", "onExerciseStarted suppressed — in framing/greeting phase");
        return;
      }
      // The range check comes first (the owner's run: the intro said "raise
      // your right arm", the patient started, then the range check cut in).
      // The intro is given when it finishes.
      if (reachDue() || reachRef.current) {
        deferredIntroRef.current = true;
        writeDebugLog("info", "COACHING", "Exercise intro waits for the range check");
        return;
      }
      coachingCallbacksRef.current.onExerciseStarted(nowMs);
    },
    feedFrame: (params: any) => coachingCallbacksRef.current.feedFrame(params),
  }).current;

  // A later exercise that needed positioning: once placed, restart the
  // guide's demonstration clock and give the intro.
  useEffect(() => {
    if (!pendingIntroRef.current || !framingIntelligence.prerequisiteResult.allMet) return;
    if (sessionPhaseRef.current !== "running") return;
    pendingIntroRef.current = false;
    ghostReadyStartRef.current = performance.now();
    narratorRef.current.reset();
    writeDebugLog("info", "COACHING", "Placed: starting the exercise intro");
    stableCoachingCallbacks.onExerciseStarted(Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framingIntelligence.prerequisiteResult]);

  const framingCallbacks = useMemo(() => ({
    evaluateFraming: framingIntelligence.evaluateFraming,
    cancelPendingEval: framingIntelligence.cancelPendingEval,
    getPrerequisiteResult: () => framingIntelligence.prerequisiteResultRef.current,
  }), [framingIntelligence.evaluateFraming, framingIntelligence.cancelPendingEval, framingIntelligence.prerequisiteResultRef]);

  // ── FRAMING CONFIRMATION AUTO-ADVANCE ────────────────────────────────────
  // Watches prerequisiteResult during the framing phase.
  // When prerequisites transition from failing → passing, speaks confirmation
  // then advances to the running phase after a 1.5s pause.
  const framingPhaseStartMsRef = useRef<number>(0);
  useEffect(() => {
    const prereq = framingIntelligence.prerequisiteResult;
    if (sessionPhaseRef.current !== "framing") return;
    if (framingConfirmedRef.current) return;

    if (!prereq.allMet) {
      prereqWasFailingRef.current = true;
      return;
    }

    // Prerequisites are met — but only auto-advance if:
    // (a) they were previously failing (genuine correction happened), OR
    // (b) at least 2s have passed in framing phase (enough time for patient to hear instruction)
    const elapsed = Date.now() - framingPhaseStartMsRef.current;
    const genuineCorrection = prereqWasFailingRef.current;
    if (!genuineCorrection && elapsed < 2000) return;

    // Prerequisites satisfied — confirm and advance
    framingConfirmedRef.current = true;
    sessionPhaseRef.current = "confirmed";
    setSessionPhase("confirmed");
    writeDebugLog("info", "SESSION", "Framing confirmed — prerequisites met, starting session");

    // Speak confirmation
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance("Perfect — I can see you clearly. Let's begin.");
      utt.rate = coachRef.current.voiceRate; utt.pitch = 1.0; utt.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find(v => v.lang.startsWith("en") && (
        v.name.includes("Natural") || v.name.includes("Neural") ||
        v.name.includes("Premium") || v.name.includes("Samantha") ||
        v.name.includes("Karen")   || v.name.includes("Daniel")
      ));
      if (pref) utt.voice = pref;
      window.speechSynthesis.speak(utt);
    }

    // Advance to running after 1.5s
    window.setTimeout(() => {
      sessionPhaseRef.current = "running";
      setSessionPhase("running");
      ghostReadyStartRef.current = performance.now(); // the ghost's demo starts now, not at Begin
      writeDebugLog("info", "SESSION", "Session running — firing exercise_started");
      stableCoachingCallbacks.onExerciseStarted(Date.now());
    }, 1500);
  }, [framingIntelligence.prerequisiteResult, stableCoachingCallbacks]);

  // ============================================================
  // EXERCISE COMPLETE
  // ============================================================

  const handleExerciseComplete = useCallback(() => {
    const prescription = sessionQueue.getActivePrescription();
    const exerciseCtx = patientContext.getCurrentExerciseContext();
    writeDebugLog("success", "SESSION", `Exercise complete: ${prescription?.name ?? "?"}`);
    // Lock in the last-known confidence value from feedFrame snapshots.
    // getLandmarkConfidencePct() may already be stale/reset by the time this fires,
    // so we read from liveConfidenceSnapshotRef which was updated every frame.
    const completedIdx = sessionQueue.queueIndex;
    {
      const full = fullIndexOf(completedIdx);
      const done = Array.from(new Set([...doneIdxRef.current, full])).sort((a, b) => a - b);
      doneIdxRef.current = done;
      setDoneIdx(done);
      // The last one is saved as completed with the results.
      if (done.length < fullQueue.length) postProgress("in_progress", done);
    }
    exerciseLandmarkConfidenceRef.current[completedIdx] = liveConfidenceSnapshotRef.current;
    liveConfidenceSnapshotRef.current = null; // reset for next exercise
    writeDebugLog("info", "RESULTS", `landmark_confidence[${completedIdx}]=${exerciseLandmarkConfidenceRef.current[completedIdx] ?? "null"}`);
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
          // Same camera set-up as the last exercise: the patient stays placed.
          framingIntelligence.reset("Position yourself for the next exercise.", true);
          // ── TRANSITION: capture current ghostT before reset ────────────────
          // The tick loop will lerp ghostT from this value down to 0 over
          // TRANSITION_MS (300ms) before the new exercise teaching anim starts.
          // This prevents the arm snapping from one exercise position to another.
          const currentGhostT = ghostPhaseInfRef.current === "holding" ? 1
            : ghostPhaseInfRef.current === "lifting" ? 1
            : ghostPhaseInfRef.current === "lowering" ? 0.5
            : 0;
          ghostTransitionRef.current = { active: true, startMs: performance.now(), fromGhostT: currentGhostT };
          // Reset ghost smoothing so new exercise anchors to fresh shoulder position
          ghostFrameInitRef.current = false;
          ghostRepCountRef.current = 0;
          ghostPrevPhaseRef.current = "";
          ghostPhaseSeenRef.current = "";
    repCoachRef.current.reset();
    narratorRef.current.reset();
    // The guide keeps the patient's posture into the next exercise (same
    // person, same chair): restarting from the template's posture made it
    // sit again for a patient who had stood up.
    handSamplesRef.current = [];
    reachRef.current = null;
    inferenceLoop.setRepHold(false);
          ghostReadyStartRef.current = performance.now();
          setGhostPhase("demo"); setGhostDemoProgress(0); setGhostHoldMs(0);
          patientContext.beginExercise(nextItem.prescription, nextIndex, sessionQueue.getActiveQueue().length);
          framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), nextItem.prescription, Date.now());
          // The intro (and the guide's demonstration) start once the patient
          // is placed: now if they still are, else when positioning locks.
          if (framingIntelligence.prerequisiteResultRef.current.allMet) {
            stableCoachingCallbacks.onExerciseStarted(Date.now());
          } else {
            pendingIntroRef.current = true;
            writeDebugLog("info", "COACHING", "Exercise intro waits until the patient is placed");
          }
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
        sessionDoneRef.current = true; // the rep coach and the guide stop talking (they used to call "that's your left arm" over the summary)
        window.speechSynthesis?.cancel();
        writeSessionResults();
        flushDebugLogToSupabase("session_end");
      }
    );
  }, [sessionQueue, patientContext, coachingBrain, patientProfile, inferenceLoop, framingIntelligence, restBoundaries, postProgress, fullQueue.length]);

  // ============================================================
  // SESSION RESULTS WRITER
  // ============================================================
  // Called when all exercises are complete.
  // Writes to session_results + exercise_results in Supabase,
  // then updates session_prescriptions.status → completed.
  // ============================================================

  // How a session that ends early is saved: "paused" (finish later today) or
  // "completed" (finish now). Set by the End dialog and the walk-away timer.
  const endModeRef = useRef<{ status: "paused" | "completed"; reason?: string }>({ status: "paused", reason: "ended" });

  async function writeSessionResults(partial = false) {
    // Status and progress first, through the server (patients aren't signed
    // in), so they are saved even if writing the results below fails.
    // Early endings are "paused" (resumable today) or "completed".
    if (partial) postProgress(endModeRef.current.status, doneIdxRef.current, endModeRef.current.reason);
    else postProgress("completed", fullQueue.map((_, i) => i));
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

    writeDebugLog("info", "RESULTS", `Writing session results — ${allEx.length} exercises, score: ${mobilityScore}${partial ? " [PARTIAL]" : ""}`);

    // Build per-exercise clinical data block for the AI prompt
    const exerciseClinicalData = allEx.map((ex, i) => {
      const queueItem = sessionQueue.getActiveQueue()[i];
      const p = queueItem?.prescription as any;
      const romTarget = p?.romTargetDegrees ?? p?.romAcceptableMin ?? null;
      const encourageTarget = p?.encourageThreshold ?? null;
      const holdTargetMs = queueItem?.prescription?.hold?.durationMs ?? null;
      const repTimeline = exerciseRepTimelineRef.current[i] ?? [];
      const peaks = repTimeline.filter(r => r.outcome === "success" && r.peakRomDeg !== null).map(r => r.peakRomDeg as number);
      const firstHalfPeaks = peaks.slice(0, Math.ceil(peaks.length / 2));
      const secondHalfPeaks = peaks.slice(Math.ceil(peaks.length / 2));
      const avgFirst = firstHalfPeaks.length > 0 ? Math.round(firstHalfPeaks.reduce((a, b) => a + b, 0) / firstHalfPeaks.length) : null;
      const avgSecond = secondHalfPeaks.length > 0 ? Math.round(secondHalfPeaks.reduce((a, b) => a + b, 0) / secondHalfPeaks.length) : null;
      const romTrend = avgFirst !== null && avgSecond !== null ? (avgSecond - avgFirst) : null;
      const holds = repTimeline.filter(r => r.outcome === "success" && r.holdMs !== null).map(r => r.holdMs as number);
      const avgHoldS = holds.length > 0 ? (holds.reduce((a, b) => a + b, 0) / holds.length / 1000).toFixed(1) : null;
      const holdCompliance = holdTargetMs && holds.length > 0
        ? Math.round(holds.filter(h => h >= holdTargetMs * 0.9).length / holds.length * 100)
        : null;
      const conf = exerciseLandmarkConfidenceRef.current[i] ?? null;
      const perRepStr = repTimeline.map(r =>
        `    Rep ${r.rep}: ${r.outcome === "success" ? "✓" : "✗"} peak=${r.peakRomDeg !== null ? r.peakRomDeg.toFixed(1) + "°" : "n/a"} hold=${r.holdMs !== null ? (r.holdMs / 1000).toFixed(1) + "s" : "n/a"}${r.failureReason ? " FAIL:" + r.failureReason.replace(/_/g, " ") : ""}`
      ).join("\n");
      return `Exercise ${i + 1}: ${ex.exerciseName}
  Reps: ${ex.successfulReps}/${ex.repTarget} successful (${ex.failedReps} failed)
  ROM target: ${romTarget !== null ? romTarget + "°" : "population norm"} | Encourage-to: ${encourageTarget !== null ? encourageTarget + "°" : "not set"}
  Avg peak ROM: ${exercisePeakMetricsRef.current[i]?.length ? Math.round(exercisePeakMetricsRef.current[i].reduce((a, b) => a + b, 0) / exercisePeakMetricsRef.current[i].length) + "°" : "n/a"}
  ROM trend (early vs late reps): ${romTrend !== null ? (romTrend > 0 ? "+" : "") + romTrend + "° (early avg " + avgFirst + "° → late avg " + avgSecond + "°)" : "insufficient data"}
  Hold target: ${holdTargetMs !== null ? (holdTargetMs / 1000).toFixed(1) + "s" : "none"} | Avg hold: ${avgHoldS !== null ? avgHoldS + "s" : "n/a"} | Hold compliance (≥90%): ${holdCompliance !== null ? holdCompliance + "%" : "n/a"}
  Failures — height: ${ex.failureReasons.height} hold: ${ex.failureReasons.hold} balance: ${ex.failureReasons.balance} isolation: ${ex.failureReasons.isolation}
  Landmark confidence: ${conf !== null ? conf + "%" : "not captured"}
  Per-rep detail:
${perRepStr}`;
    }).join("\n\n");

    // Generate clinical AI summary
    let aiSummary = "Session data recorded.";
    try {
      const summaryPrompt = `You are a clinical physiotherapy analyst writing a session report for a physiotherapist and physician. Be analytical, specific, and clinically precise. Do not use generic praise.

PATIENT: ${patientProfile.type.replace(/_/g, " ")} | Session duration: ${Math.round(durationMs / 60000)} min | Mobility score: ${mobilityScore}/100${partial ? " (session ended early)" : ""}

SESSION DATA:
${exerciseClinicalData}

Write a clinical summary covering:
1. Overall session performance and mobility score interpretation
2. Per-exercise ROM achievement vs target — did the patient meet, exceed, or fall short?
3. Hold compliance — were prescribed hold durations maintained?
4. Failure patterns — what types of failures occurred and what do they suggest clinically?
5. ROM trend within exercises — any sign of fatigue or warm-up effect across reps?
6. Any compensation or isolation failures that warrant attention
7. Recommended focus for the next session

Format: 3-5 short clinical paragraphs. No bullet points. No patient-facing language. Write as if handing this to the treating physiotherapist.`;

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: summaryPrompt,
          system: "You are a clinical physiotherapy analyst. Write concise, data-driven clinical session reports for physiotherapists. No praise, no patient-facing language, no bullet points. Pure clinical analysis."
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.text) aiSummary = d.text;
      }
    } catch { /* use default */ }

    // Show post-session summary overlay immediately
    setSessionSummary({
      paused: partial && endModeRef.current.status === "paused",
      mobilityScore,
      durationMs,
      aiSummary,
      partial,
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
          movement_timeline: exerciseRepTimelineRef.current[i]?.length
            ? exerciseRepTimelineRef.current[i]
            : null,
          landmark_confidence_pct: exerciseLandmarkConfidenceRef.current[i] ?? null,
          comfortable_range_deg: reachRangeRef.current[i] ?? null,
        };
      });

      const { error: exErr } = await supabase.from("exercise_results").insert(exerciseRows);
      if (exErr) {
        writeDebugLog("error", "RESULTS", "Failed to insert exercise_results", exErr.message);
      } else {
        writeDebugLog("success", "RESULTS", `exercise_results written — ${exerciseRows.length} rows`);
      }


    } catch (err) {
      writeDebugLog("error", "RESULTS", "writeSessionResults threw", err instanceof Error ? err.message : String(err));
    }
  }

  // ============================================================
  // FLUSH DEBUG LOG TO SUPABASE
  // ============================================================
  // Writes the full in-memory debug log as a single JSON blob.
  // Called at session end, on pause, and on error.
  // Claude can query session_debug_logs directly via Supabase MCP
  // to diagnose framing and engine issues without any copy-paste.
  // ============================================================

  async function flushDebugLogToSupabase(reason: "session_end" | "pause" | "error" | "manual" | "page_hidden" | "periodic") {
    if (!prescriptionId) return; // no session ID — can't associate the log
    try {
      const supabase = getSupabaseClient();
      // globalDebugLog is newest-first — reverse to get chronological order for Supabase
      const allEntries = [
        { level: "info", category: "APP", message: `app ${versionLabel()} · assignment ${assignmentCode(prescriptionId)}`, app_version: APP_VERSION, app_commit: APP_COMMIT, app_branch: APP_BRANCH, assignment: assignmentCode(prescriptionId), timestamp: new Date().toISOString() },
        ...[...globalDebugLog].reverse(),
      ];
      const framingOnly = allEntries.filter(e => e.category === "FRAMING" || e.level === "FRAMING_VOICE" || e.level === "FRAMING_SNAP");
      const exerciseCount = sessionQueue.getActiveQueue().length;

      const { error } = await supabase.from("session_debug_logs").insert({
        session_id:      prescriptionId,
        patient_id:      patientId ?? null,
        flush_reason:    reason,
        log_entries:     allEntries,
        framing_entries: framingOnly,
        exercise_count:  exerciseCount,
        total_entries:   allEntries.length,
      });

      if (error) {
        console.warn("[DEBUG FLUSH] Failed to write debug log:", error.message);
      } else {
        console.log(`[DEBUG FLUSH] Wrote ${allEntries.length} entries (${framingOnly.length} framing) — reason=${reason} session=${prescriptionId}`);
      }
    } catch (err) {
      console.warn("[DEBUG FLUSH] Threw:", err);
    }
  }

  // Save the log when the tab is hidden or closed mid-session too, so a test
  // run that is never ended with End still reaches session_debug_logs.
  const flushRef = useRef(flushDebugLogToSupabase);
  flushRef.current = flushDebugLogToSupabase;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && sessionQueue.sessionStarted && globalDebugLog.length > 0) {
        void flushRef.current("page_hidden");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    // And every 30 s while it runs, so every test run reaches Supabase even
    // if the tab is left open (each row holds the whole log so far; read the
    // newest row per session).
    const timer = sessionQueue.sessionStarted
      ? window.setInterval(() => { if (globalDebugLog.length > 0) void flushRef.current("periodic"); }, 30000)
      : null;
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [sessionQueue.sessionStarted]);

  // Switching to another tab pauses the session (Resume carries on).
  const pauseRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && sessionQueue.sessionStarted && sessionPhaseRef.current === "running") {
        writeDebugLog("info", "SESSION", "Tab hidden: pausing");
        pauseRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sessionQueue.sessionStarted]);

  // Walking away: nobody seen for 10 s pauses the coaching, a countdown
  // shows from 60 s, and at 90 s the session is saved (paused, resumable
  // today) and ends. Seeing the patient again carries on at once.
  const endRef = useRef<(partial: boolean, mode: { status: "paused" | "completed"; reason?: string }) => void>(() => {});
  useEffect(() => {
    const live = sessionQueue.sessionStarted && sessionPhase === "running" && !isPaused && !sessionSummary && !restScreen;
    if (!live) { setAway((a) => (a.kind === "present" ? a : { kind: "present" })); return; }
    const t = window.setInterval(() => {
      const c = coachRef.current;
      const next = awayState((Date.now() - lastSeenMsRef.current) / 1000, { pause: c.awayPauseSeconds, countdown: c.awayCountdownSeconds, end: c.awayEndSeconds });
      setAway((prev) => {
        if (prev.kind === next.kind && (next.kind !== "countdown" || (prev as any).secondsLeft === next.secondsLeft)) return prev;
        return next;
      });
    }, 500);
    return () => window.clearInterval(t);
  }, [sessionQueue.sessionStarted, sessionPhase, isPaused, sessionSummary, restScreen]);
  const awayKindRef = useRef<AwayState["kind"]>("present");
  const awaySaidAtRef = useRef(0); // "I can't see you" at most every 30 s
  useEffect(() => {
    const before = awayKindRef.current;
    awayKindRef.current = away.kind;
    if (before === away.kind) return;
    const say = (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis || !voiceOn) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = coachRef.current.voiceRate;
      window.speechSynthesis.speak(u);
    };
    if (away.kind === "paused" && before === "present") {
      writeDebugLog("warning", "SESSION", "Patient not seen for 10 s: pausing");
      coachingBrain.setVoiceEnabled(false);
      if (Date.now() - awaySaidAtRef.current > 30000) {
        awaySaidAtRef.current = Date.now();
        say("I can't see you. Your session is paused. Step back in front of the camera to carry on.");
      }
    } else if (away.kind === "countdown" && before !== "countdown") {
      writeDebugLog("warning", "SESSION", "Patient away 60 s: countdown to save and end");
      say("Your session will be saved and closed in thirty seconds.");
    } else if (away.kind === "present" && before !== "present") {
      writeDebugLog("info", "SESSION", "Patient back: carrying on");
      coachingBrain.setVoiceEnabled(voiceOn);
      if (sessionPhaseRef.current === "running" && !sessionSummary) say("Welcome back. Let's carry on.");
    } else if (away.kind === "end") {
      writeDebugLog("warning", "SESSION", "Patient away 90 s: saving and ending (paused)");
      endRef.current(true, { status: "paused", reason: "walked_away" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [away.kind]);
  function imBack() {
    lastSeenMsRef.current = Date.now();
    presenceRef.current.reset(Date.now());
    setAway({ kind: "present" });
  }

  // Welcome back: Continue runs only the unfinished exercises; Start over
  // runs them all. Begin waits a render so the run queue is in place.
  function continueSession() {
    setRunIndexes(resume.remaining);
    setPendingBegin(true);
  }
  function startOver() {
    setRunIndexes(null);
    setPendingBegin(true);
  }
  useEffect(() => {
    if (!pendingBegin) return;
    setPendingBegin(false);
    void beginCombinedSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBegin, combinedQueue]);

  async function beginCombinedSession() {
    if (combinedQueue.length === 0) return;
    sessionStartedAtMsRef.current = Date.now();
    globalDebugLog = []; // clear buffer from any previous session
    writeDebugLog("info", "SESSION", `Beginning — ${combinedQueue.length} exercise(s), patient: ${patientProfile.type}`, `app ${versionLabel()}`);
    exerciseLandmarkConfidenceRef.current = {};
    exercisePeakMetricsRef.current = {};
    exerciseHoldDurationsRef.current = {};
    exerciseRepTimelineRef.current = {};
    liveConfidenceSnapshotRef.current = null;
    checkAiEngine(true);

    sessionDoneRef.current = false;
    deferredIntroRef.current = false;
    const started = sessionQueue.beginSession(combinedQueue);
    if (!started) { writeDebugLog("error", "SESSION", "beginSession returned false"); return; }
    // Progress: continuing keeps what was finished earlier today.
    const startDone = runIndexesRef.current ? resume.done : [];
    doneIdxRef.current = startDone;
    setDoneIdx(startDone);
    lastSeenMsRef.current = Date.now();
    presenceRef.current.reset(Date.now());
    if (runIndexesRef.current) writeDebugLog("info", "SESSION", `Continuing: exercises ${runIndexesRef.current.map((i) => i + 1).join(", ")} of ${fullQueue.length}`);
    postProgress("in_progress", startDone);
    setSelectorCollapsed(true);
    patientContext.beginSession();
    patientContext.beginExercise(combinedQueue[0].prescription, 0, combinedQueue.length);

    // ── PHASE: greeting ──────────────────────────────────────────────────
    // Generate and speak a personalised greeting before camera starts.
    sessionPhaseRef.current = "greeting";
    setSessionPhase("greeting");
    greetingSpokenRef.current = false;

    // Build greeting text
    const firstName = patientName ? patientName.split(" ")[0] : "there";
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const exerciseNames = combinedQueue.map(q => q.prescription.name).join(", ");
    const firstExerciseName = combinedQueue[0].prescription.name;

    // Previous session context
    let prevContext = "This is your first session — welcome.";
    if (previousSession) {
      const score = previousSession.mobilityScore;
      prevContext = `Last session was "${previousSession.sessionTitle}" with a mobility score of ${score} out of 100.`;
    }

    // Framing instruction for first exercise
    const firstPrescription = combinedQueue[0].prescription;
    const coverage = (firstPrescription as any)?.framing?.requiredCoverage ?? "upper_body";
    const framingHint = coverage === "full_body"
      ? `For ${firstExerciseName}, I'll need to see your full body — head to feet.`
      : coverage === "torso_and_hips"
      ? `For ${firstExerciseName}, I'll need to see from your head to your knees.`
      : `For ${firstExerciseName}, I'll need to see your upper body clearly.`;

    // Generate greeting via Claude
    let greetingText: string;
    try {
      const resp = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `You are a warm, professional physiotherapy AI assistant. Generate a spoken session greeting of 2–3 sentences maximum. Be warm but efficient — patients are standing ready to exercise. Do not use markdown. Speak naturally as if talking to someone face-to-face.`,
          messages: [{
            role: "user",
            content: `Generate a greeting for:
- Patient: ${firstName}
- Time of day: ${timeOfDay}
- Today's exercises: ${exerciseNames}
- Previous session: ${prevContext}
- End with this framing instruction: "${framingHint}"

Keep it to 2–3 natural spoken sentences. No lists.`
          }]
        })
      });
      const data = await resp.json();
      greetingText = data.text || (data.content?.[0]?.text ?? `Good ${timeOfDay}, ${firstName}. Today we'll work through ${exerciseNames}. ${framingHint}`);
    } catch {
      greetingText = `Good ${timeOfDay}, ${firstName}. Today we'll work through ${exerciseNames}. ${prevContext} ${framingHint}`;
    }

    writeDebugLog("info", "GREETING", "Speaking greeting", greetingText.slice(0, 100));
    setGreetingCaption(greetingText.replace(/\s+/g, " ").trim());

    // Speak the greeting, then start camera for framing phase
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(greetingText);
      utt.rate = coachRef.current.voiceRate; utt.pitch = 1.0; utt.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find(v => v.lang.startsWith("en") && (
        v.name.includes("Natural") || v.name.includes("Neural") ||
        v.name.includes("Premium") || v.name.includes("Samantha") ||
        v.name.includes("Karen")   || v.name.includes("Daniel")
      ));
      if (pref) utt.voice = pref;
      utt.onend = () => {
        greetingSpokenRef.current = true;
        startFramingPhase();
      };
      // Fallback — if onend never fires (browser bug), start framing after 12s
      window.setTimeout(() => {
        if (!greetingSpokenRef.current) startFramingPhase();
      }, 12000);
      window.speechSynthesis.speak(utt);
    } else {
      // No speech synthesis — skip greeting
      startFramingPhase();
    }
  }

  async function startFramingPhase() {
    if (framingConfirmedRef.current) return; // already advanced
    greetingSpokenRef.current = true;
    sessionPhaseRef.current = "framing";
    setSessionPhase("framing");
    prereqWasFailingRef.current = false;
    framingPhaseStartMsRef.current = Date.now();
    writeDebugLog("info", "SESSION", "Framing phase started — camera on");

    framingIntelligence.reset("Checking your position…");
    try {
      await cameraRef.current?.startCamera();
    } catch (error) {
      writeDebugLog("error", "SESSION", "Camera failed", String(error));
      sessionQueue.endSession();
    }
  }

  function handleCameraReady(video: HTMLVideoElement) {
    videoElementRef.current = video;
    const prescription = sessionQueue.getActivePrescription();
    writeDebugLog("info", "CAMERA", "Camera ready", `prescription=${prescription?.id ?? "null"} phase=${sessionPhaseRef.current}`);
    if (!prescription) { writeDebugLog("error", "CAMERA", "No active prescription"); return; }

    // In framing phase — start inference loop but suppress exercise_started coaching
    // (greeting already explained the protocol). forcePreExerciseCheck handles voice.
    framingIntelligence.forcePreExerciseCheck(null, createEmptyFeatures(), prescription, Date.now());
    inferenceLoop.startLoop(video, sessionQueue.getActivePrescription, handleExerciseComplete, stableCoachingCallbacks, framingCallbacks, readinessEvaluator);
    // Start ghost render loop
    // Reset frame smoothing so first exercise anchors cleanly to fresh pose
    ghostFrameInitRef.current = false;
    ghostRepCountRef.current = 0;
    ghostPrevPhaseRef.current = "";
    ghostPhaseSeenRef.current = "";
    repCoachRef.current.reset();
    narratorRef.current.reset();
    postureLatchRef.current = null;
    handSamplesRef.current = [];
    reachRef.current = null;
    inferenceLoop.setRepHold(false);
    reachDoneRef.current = new Set(); // a fresh start checks the range again
    sessionDoneRef.current = false;
    deferredIntroRef.current = false;
    ghostReadyStartRef.current = performance.now();
    ghostTransitionRef.current = { active: false, startMs: 0, fromGhostT: 0 };
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

    // ── TRANSITION_MS: time to fade ghost to rest between exercises ──────────
    const TRANSITION_MS = 300;

    let lastT = performance.now();

    function tick() {
      const canvas = ghostCanvasRef.current;
      if (!canvas) { ghostAnimRef.current = requestAnimationFrame(tick); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Fixed 640×480 buffer — CSS scales it to 100%
      const W = 640; const H = 480;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

      const now = performance.now();
      lastT = now;
      ctx.clearRect(0, 0, W, H);

      // ── 1. Get live frame ─────────────────────────────────────────────────
      const frame = ghostFrameRef.current;
      // Steady presence, not any detection (the owner's run: one stray frame
      // in an empty room said "welcome back").
      {
        const present = presenceRef.current.update(Date.now(), seenInFrame(frame as any));
        lastSeenMsRef.current = presenceRef.current.lastPresentMs;
        // Reps stop while the patient is away or being repositioned (placement
        // lost: moved too close, out of the picture); the positioning coach
        // guides them back, then reps carry on.
        const placedNow = framingIntelligence.prerequisiteResultRef.current.allMet;
        const why = sessionPhaseRef.current !== "running" ? null : !present ? "patient out of view" : !placedNow ? "repositioning" : null;
        inferenceLoop.setFrozen(why === null ? null : why === "repositioning" ? "reposition" : "away");
        if (why !== frozenLoggedRef.current) {
          writeDebugLog("info", "SESSION", why ? `Reps paused: ${why}` : "Reps carry on");
          frozenLoggedRef.current = why;
        }
      }
      if (!frame || !frame.personDetected) {
        ghostAnimRef.current = requestAnimationFrame(tick);
        return;
      }

      // ── 2. Sample landmark confidence every frame ─────────────────────────
      const prescriptionForConf = ghostPrescriptionRef.current;
      if (prescriptionForConf) {
        framingIntelligence.sampleLandmarkConfidence(frame, prescriptionForConf);
        const confNow = framingIntelligence.getLandmarkConfidencePct();
        if (confNow !== null) liveConfidenceSnapshotRef.current = confNow;
      }

      // ── 3. Framing debug snapshot (every 2s) ──────────────────────────────
      const snapNow = Date.now();
      if (snapNow - lastFramingSnapMsRef.current >= 2000) {
        lastFramingSnapMsRef.current = snapNow;
        const fp     = framingIntelligence.framingPanelState;
        const prereq = framingIntelligence.prerequisiteResultRef.current;
        const conf   = liveConfidenceSnapshotRef.current;
        const phase  = ghostPhaseInfRef.current;
        const prescription = ghostPrescriptionRef.current;
        const liveObs = inferenceLoop.liveObservation;
        const lmLines: string[] = [];
        const lmData = (frame as any)?.landmarks ?? {};
        const allLm = ["nose","left_shoulder","right_shoulder","left_elbow","right_elbow",
                       "left_wrist","right_wrist","left_hip","right_hip",
                       "left_knee","right_knee","left_ankle","right_ankle"];
        for (const name of allLm) {
          const pt = lmData[name];
          if (!pt) { lmLines.push(`  ${name}: NOT DETECTED`); continue; }
          const score = typeof pt.score === "number" ? pt.score : 1;
          lmLines.push(`  ${score >= 0.15 ? "✓" : "✗"} ${name}: ${(score * 100).toFixed(0)}%`);
        }
        const prereqLines = prereq.allMet
          ? ["  ✓ All prerequisites met"]
          : prereq.failures.map((f: any) => `  ✗ [${f.id}] "${f.patientMessage}"\n     clinical: ${f.clinicalNote}`);
        const coverageEstimate = (() => {
          const lm = lmData;
          const v = (n: string) => { const p = lm[n]; return p && typeof p.score === "number" ? p.score > 0.2 : !!p; };
          const hasHead = v("nose"); const hasSh = v("left_shoulder") && v("right_shoulder");
          const hasHips = v("left_hip") && v("right_hip");
          const hasKnee = v("left_knee") || v("right_knee");
          const hasAnk  = v("left_ankle") || v("right_ankle");
          if (hasHead && hasSh && hasHips && hasKnee && hasAnk) return "full_body";
          if (hasHead && hasSh && hasHips && hasKnee) return "torso_and_hips (no ankles)";
          if (hasHead && hasSh && hasHips) return "torso_and_hips (no knees)";
          if (hasHead && hasSh) return "upper_body";
          return hasHead ? "head_only" : "none";
        })();
        const detail = [
          `── EXERCISE ─────────────────────────────`,
          `  id:       ${prescription?.id ?? "none"}`,
          `  phase:    ${phase}`,
          `  required_coverage: ${(prescription as any)?.framing?.requiredCoverage ?? "?"}`,
          `  required_posture:  ${prescription?.framing?.requiredStartPosture ?? "?"}`,
          `  bilateral: ${prescription?.framing?.bilateralSymmetryRequired ?? false}`,
          ``,
          `── CAMERA SEES ──────────────────────────`,
          `  coverage_estimate: ${coverageEstimate}`,
          `  confidence_pct:    ${conf !== null ? conf + "%" : "not sampled yet"}`,
          `  person_detected:   ${frame?.personDetected ?? false}`,
          `  posture:           ${liveObs.movementLines[0] ?? "unknown"}`,
          ``,
          `── LANDMARK CONFIDENCE ──────────────────`,
          ...lmLines,
          ``,
          `── PREREQUISITES ────────────────────────`,
          ...prereqLines,
          ``,
          `── FRAMING PANEL ────────────────────────`,
          `  severity:  ${fp.severity}`,
          `  tone:      ${fp.tone}`,
          `  message:   "${fp.message}"`,
          `  evaluating: ${fp.evaluating}`,
        ].join("\n");
        const headline = !frame?.personDetected
          ? "❌ No person detected"
          : !prereq.allMet
          ? `🔴 PREREQ BLOCKED [${prereq.failures[0]?.id ?? "?"}] — ${prereq.failures[0]?.patientMessage ?? ""}`
          : fp.severity === "ok"
          ? `✅ Framing OK — conf=${conf ?? "?"}% phase=${phase}`
          : `⚠ Framing ${fp.severity} — "${fp.message}" conf=${conf ?? "?"}%`;
        writeDebugLog("FRAMING_SNAP", "FRAMING", headline, detail);
      }

      // ── 3b. Measurement trace (every 1 s while running) ─────────────────
      // What the rep logic sees, so a saved test run shows why a rep did or
      // didn't count: phase, the measured angle, the thresholds in force,
      // which way the patient faces, the learned arm length, the lock.
      if (sessionPhaseRef.current === "running" && snapNow - lastTraceMsRef.current >= 1000) {
        lastTraceMsRef.current = snapNow;
        const p = ghostPrescriptionRef.current;
        const side = (p?.side === "left" ? "left" : "right") as "left" | "right";
        const m = ghostActiveMetricRef.current;
        const L = inferenceLoop.getArmLength(side);
        const w3 = inferenceLoop.getWorld3D()[side];
        const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "?" : v.toFixed(1));
        writeDebugLog("info", "TRACE",
          `${ghostPhaseInfRef.current} | metric=${m === null ? "null" : m.toFixed(1)} | start=${p?.startThreshold?.toFixed(1) ?? "?"} ` +
          `target=${p?.targetThreshold?.toFixed(1) ?? "?"} finish=${p?.finishThreshold?.toFixed(1) ?? "?"} | ` +
          `view=${inferenceLoop.getFacingView() ?? "?"} arm=${L === null ? "?" : L.toFixed(3)} | ` +
          `placed=${framingIntelligence.prerequisiteResultRef.current.allMet} reps=${ghostRepCountRef.current} | ` +
          `baseline=${inferenceLoop.calibrationBaselineRef.current.toFixed(1)} | ` +
          // Form (2D, facing the camera) and the 3D experiment, for comparison.
          `plane2d=${fmt(inferenceLoop.getFeatures()?.[side === "left" ? "leftArmPlaneDeg" : "rightArmPlaneDeg"])} ` +
          `bent=${inferenceLoop.getFeatures()?.[side === "left" ? "leftElbowBent" : "rightElbowBent"] ?? "?"} | ` +
          `3d: elev=${fmt(w3?.elevDeg)} plane=${fmt(w3?.planeDeg)} elbow=${fmt(w3?.elbowDeg)} | ` +
          `opp=${fmt(inferenceLoop.getFeatures()?.[side === "left" ? "rightArmElevationDeg" : "leftArmElevationDeg"])} ` +
          `wrongArm=${repCoachRef.current.wrongArmNow} reach=${reachRef.current?.stage ?? "-"} path=${pathSidewaysNow() ? "side" : "ok"} ` +
          `guide=${postureLatchRef.current?.get() ?? "?"} legs=${inferenceLoop.getFeatures()?.posture ?? "?"} shY=${inferenceLoop.getFeatures()?.shoulderCenterY?.toFixed(3) ?? "?"}`);
      }

      // ── 3c. Coaching through the rep (lib/coaching/repCoach.ts) ─────────
      // Only once the patient is placed: while they are being positioned the
      // positioning coach talks, nothing else (the owner's run).
      // (Before the first rep only, like the positioning screen: a brief
      // slip mid-exercise must not silence the coaching.)
      // The rep counter stays held from the start of the exercise until its
      // range check is done, so a patient can't start reps before it.
      inferenceLoop.setRepHold(reachRef.current !== null || reachDue());
      // Nobody to coach: the session is over, the exercise is done, or the
      // patient isn't in front of the camera (the owner's run: "that's your
      // left arm" over the session summary and while out of view).
      // Placement is needed throughout, not just before the first rep: while
      // the patient is being repositioned only the positioning coach talks.
      const coachable = !sessionDoneRef.current && ghostPhaseInfRef.current !== "complete" &&
        awayKindRef.current === "present" && presenceRef.current.present;
      const placedForCoaching = coachable && !pendingIntroRef.current &&
        framingIntelligence.prerequisiteResultRef.current.allMet;
      if (!placedForCoaching) {
        narratorRef.current.update(null, false);
        ghostReadyStartRef.current = performance.now(); // the demonstration starts when placed
      }
      // ── 3b. The range check (lib/session/reachCheck.ts) ────────────────
      // Before each arm's first forward raise: lift it as high as is
      // comfortable and hold, once. The rep counter is held meanwhile, and
      // the guide's demonstration and the rep coach wait.
      if (sessionPhaseRef.current === "running" && placedForCoaching) {
        const pR = ghostPrescriptionRef.current;
        const sdR = pR?.side === "left" ? "left" : pR?.side === "right" ? "right" : null;
        if (!reachRef.current && pR && sdR && (ghostSlugRef.current ?? "").startsWith("shoulder_flexion") &&
            coachRef.current.reachCheckOn && !runIndexesRef.current && !reachDoneRef.current.has(sdR) &&
            ghostRepCountRef.current === 0 && ghostPhaseInfRef.current === "ready" && inferenceLoop.isCalibrated()) {
          reachRef.current = new ReachCheck({ side: sdR, start: pR.startThreshold ?? 50, target: pR.targetThreshold ?? 110, nowMs: snapNow });
          reachDoneRef.current.add(sdR);
          inferenceLoop.setRepHold(true);
          writeDebugLog("info", "REACH", `Range check: ${sdR} arm`);
        }
        const rc = reachRef.current;
        if (rc && sdR) {
          const feats = inferenceLoop.getFeatures();
          const straight = feats?.[sdR === "left" ? "leftElbowBent" : "rightElbowBent"] !== true;
          const elev3d = inferenceLoop.getWorld3D()[sdR]?.elevDeg ?? null;
          const speaking = typeof window !== "undefined" && !!window.speechSynthesis?.speaking;
          const line = rc.update(snapNow, ghostActiveMetricRef.current, { off: handOffset(frame, sdR), straight, elev3d }, !speaking);
          if (line && typeof window !== "undefined" && window.speechSynthesis) {
            const u = new SpeechSynthesisUtterance(line);
            u.rate = coachRef.current.voiceRate;
            window.speechSynthesis.speak(u);
            writeDebugLog("info", "REACH", `"${line}"`);
          }
          if (rc.stage === "done") {
            const r = rc.result();
            if (r.offsets.length) handSamplesRef.current = r.offsets;
            angleBiasRef.current.seed(r.bias);
            const qi = sessionQueue.getActiveQueueIndex?.() ?? 0;
            if (r.peak !== null) reachRangeRef.current[qi] = Math.round(r.peak);
            writeDebugLog("success", "REACH",
              `Range ${sdR}: ${r.skipped ? "skipped (no lift)" : `peak=${r.peak?.toFixed(1)}° (3d ${r.peak3d?.toFixed(1) ?? "?"}°) target=${pR?.targetThreshold}° reached=${r.reached}`}` +
              ` | hand samples=${r.offsets.length} bias=${r.bias?.toFixed(1) ?? "?"}`);
            reachRef.current = null;
            inferenceLoop.setRepHold(false);
            ghostReadyStartRef.current = performance.now(); // the guide's demonstration starts now
            narratorRef.current.reset();
            if (deferredIntroRef.current) {
              deferredIntroRef.current = false;
              writeDebugLog("info", "COACHING", "Range check done: exercise intro");
              coachingCallbacksRef.current.onExerciseStarted(Date.now());
            }
          } else {
            narratorRef.current.update(null, false);
            ghostReadyStartRef.current = performance.now();
          }
        }
      }
      if (sessionPhaseRef.current === "running" && placedForCoaching && !reachRef.current) {
        const p = ghostPrescriptionRef.current;
        const sd = p?.side === "left" ? "left" : "right";
        const feats = inferenceLoop.getFeatures();
        const plane = feats?.[sd === "left" ? "leftArmPlaneDeg" : "rightArmPlaneDeg"] ?? null;
        const flexion = (ghostSlugRef.current ?? "").startsWith("shoulder_flexion");
        const line = repCoachRef.current.update({
          nowMs: snapNow,
          phase: ghostPhaseInfRef.current,
          metric: ghostActiveMetricRef.current,
          target: p?.targetThreshold ?? 110,
          repCount: ghostRepCountRef.current,
          repTarget: p?.repTarget ?? 0,
          elbowBent: flexion ? (feats?.[sd === "left" ? "leftElbowBent" : "rightElbowBent"] ?? null) : null,
          wrongPlane: flexion && plane !== null ? plane > maxPlaneNow() : null,
          wrongPath: flexion && pathSidewaysNow(),
          side: p?.side === "both" ? "both" : sd,
          oppositeMetric: flexion ? (feats?.[sd === "left" ? "rightArmElevationDeg" : "leftArmElevationDeg"] ?? null) : null,
          startThreshold: p?.startThreshold,
        });
        // A correction ("that's your left arm") is said over anything else;
        // other lines wait for silence.
        const urgent = repCoachRef.current.lastKind === "wrongArm";
        if (line && urgent && typeof window !== "undefined" && window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
        if (line && typeof window !== "undefined" && window.speechSynthesis && !window.speechSynthesis.speaking) {
          const u = new SpeechSynthesisUtterance(line);
          u.rate = coachRef.current.voiceRate;
          window.speechSynthesis.speak(u);
          writeDebugLog("info", "COACHING", `Rep coach: "${line}"`);
        }

        // The guide narrates its demonstration (lib/coaching/demoNarrator.ts),
        // on the same clock as the figure: before the first rep, and when it
        // demonstrates again after a long pause (not the quick show between
        // reps, which "And again" covers).
        if (ghostPhaseInfRef.current === "ready" && typeof window !== "undefined" && window.speechSynthesis) {
          const reps = ghostRepCountRef.current;
          // Don't re-demonstrate while the patient is moving (e.g. trying the
          // wrong arm): hold the demo clock at the start of its wait. It used
          // to re-demonstrate every ~14 s regardless, talking over corrections.
          {
            const lead = (reps === 0 ? 0 : BETWEEN_REPS_REST_S) + DEMO_CYCLE_S;
            const s0 = (performance.now() - ghostReadyStartRef.current) / 1000;
            const recentlyActive = snapNow - repCoachRef.current.lastActivityMs < 3000;
            const firstShowing = s0 < lead;
            if ((recentlyActive && !firstShowing) || repCoachRef.current.wrongArmNow) {
              ghostReadyStartRef.current = performance.now() - lead * 1000;
            }
          }
          const sinceReady = (performance.now() - ghostReadyStartRef.current) / 1000;
          const clock = demoClock(reps === 0 ? sinceReady : sinceReady - BETWEEN_REPS_REST_S);
          const narrate = clock && (reps === 0 || clock.cycle >= 1) ? clock : null;
          const say = narratorRef.current.update(narrate, window.speechSynthesis.speaking);
          if (say && coachRef.current.demoNarrationOn) {
            const u = new SpeechSynthesisUtterance(say);
            u.rate = coachRef.current.voiceRate;
            window.speechSynthesis.speak(u);
            writeDebugLog("info", "COACHING", `Guide: "${say}"`);
          }
        } else {
          narratorRef.current.update(null, false);
        }
      }

      // ── 4. Landmarks ──────────────────────────────────────────────────────
      const rawLms = poseFrameToLandmarkArray(frame);
      const lms    = mirrorLandmarks(rawLms);
      const slug   = ghostSlugRef.current;
      if (!slug) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      // ── 5. Config — loaded once per slug, no branching in tick ───────────
      const config = getGhostConfig(slug);

      // Facing the camera, a forward raise comes toward the lens: the side-view
      // ghost would sweep the arm sideways (the wrong movement), so step 12
      // draws the front-view ghost arm and a "Reach here" line instead.
      const frontFlexion = slug.startsWith("shoulder_flexion") && inferenceLoop.getFacingView() === "front";
      if (frontFlexion !== guideInPanelRef.current) {
        guideInPanelRef.current = frontFlexion;
        setGuideInPanel(frontFlexion);
      }

      // Phase timing for the ghost (when "ready" and "lowering" began).
      {
        const ph = ghostPhaseInfRef.current;
        if (ph !== ghostPhaseSeenRef.current) {
          if (ph === "ready") ghostReadyStartRef.current = now;
          if (ph === "lowering") ghostLowerStartRef.current = now;
          ghostPhaseSeenRef.current = ph;
        }
      }

      // ── 6. Smoothed body frame (anchor + sizing) ──────────────────────────
      const freshFrame = getBodyFrame(lms as any, W, H);
      const infPhase   = ghostPhaseInfRef.current;
      const canUpdate  = freshFrame !== null &&
        (infPhase === "ready" || infPhase === "idle" || infPhase === "unknown");

      if (freshFrame && canUpdate) {
        const L = 0.15;
        if (!ghostFrameInitRef.current) {
          ghostSmoothedOriginX.current = freshFrame.origin.x;
          ghostSmoothedOriginY.current = freshFrame.origin.y;
          ghostSmoothedADX.current = freshFrame.axisDown.x;
          ghostSmoothedADY.current = freshFrame.axisDown.y;
          ghostSmoothedARX.current = freshFrame.axisRight.x;
          ghostSmoothedARY.current = freshFrame.axisRight.y;
          ghostSmoothedTorso.current = freshFrame.torsoLen;
          ghostSmoothedSW.current    = freshFrame.shoulderWidth;
          ghostFrameInitRef.current  = true;
        } else {
          ghostSmoothedOriginX.current += (freshFrame.origin.x - ghostSmoothedOriginX.current) * L;
          ghostSmoothedOriginY.current += (freshFrame.origin.y - ghostSmoothedOriginY.current) * L;
          const adX = ghostSmoothedADX.current + (freshFrame.axisDown.x  - ghostSmoothedADX.current) * L;
          const adY = ghostSmoothedADY.current + (freshFrame.axisDown.y  - ghostSmoothedADY.current) * L;
          const adM = Math.sqrt(adX*adX + adY*adY) || 1;
          ghostSmoothedADX.current = adX / adM; ghostSmoothedADY.current = adY / adM;
          const arX = ghostSmoothedARX.current + (freshFrame.axisRight.x - ghostSmoothedARX.current) * L;
          const arY = ghostSmoothedARY.current + (freshFrame.axisRight.y - ghostSmoothedARY.current) * L;
          const arM = Math.sqrt(arX*arX + arY*arY) || 1;
          ghostSmoothedARX.current = arX / arM; ghostSmoothedARY.current = arY / arM;
          ghostSmoothedTorso.current += (freshFrame.torsoLen      - ghostSmoothedTorso.current) * L;
          ghostSmoothedSW.current    += (freshFrame.shoulderWidth  - ghostSmoothedSW.current)    * L;
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
        ghostSmoothedSW.current    = freshFrame.shoulderWidth;
        ghostFrameInitRef.current  = true;
        ghostLastFrameRef.current  = freshFrame;
      }

      if (!ghostFrameInitRef.current) { ghostAnimRef.current = requestAnimationFrame(tick); return; }

      // ── 7. ROM score ──────────────────────────────────────────────────────
      const activePxMetric = ghostActiveMetricRef.current;
      const tgtThresh      = ghostPrescriptionRef.current?.targetThreshold ?? null;
      // Arm exercises calibrate a resting baseline. Knees are not calibrated
      // (baseline stays 0) but rest at ~90°, so their score starts from rest:
      // the start threshold minus its 15° margin.
      const calibBaseline  = inferenceLoop.calibrationBaselineRef.current ||
        Math.max(0, (ghostPrescriptionRef.current?.startThreshold ?? 15) - 15);
      let score = 0;
      if (activePxMetric !== null && tgtThresh !== null && tgtThresh > calibBaseline) {
        score = Math.max(0, Math.min(1, (activePxMetric - calibBaseline) / (tgtThresh - calibBaseline)));
      }
      setGhostScore(score);

      // ── 8. Animation state — pure function, no exercise knowledge ─────────
      const holdRem    = ghostHoldRemRef.current;
      const holdTotal  = ghostHoldMsRef.current > 0 ? ghostHoldMsRef.current : 5000;
      const repsDone   = ghostRepCountRef.current;
      const readyElapsedS = (now - ghostReadyStartRef.current) / 1000;

      let anim = computeGhostAnim({
        infPhase, holdRemainingMs: holdRem, holdTotalMs: holdTotal,
        repsDone, readyElapsedS, nowMs: now,
        loweringElapsedS: (now - ghostLowerStartRef.current) / 1000,
      });

      // ── 9. Exercise transition — fade ghostT to 0 over TRANSITION_MS ─────
      // Triggered by handleExerciseComplete setting ghostTransitionRef.active.
      // Prevents the ghost snapping from one exercise position to another.
      const trans = ghostTransitionRef.current;
      if (trans.active) {
        const elapsed = now - trans.startMs;
        if (elapsed < TRANSITION_MS) {
          // Override ghostT: lerp from previous ghostT down to 0
          const progress = elapsed / TRANSITION_MS;
          anim = { ...anim, ghostT: trans.fromGhostT * (1 - progress), opacity: anim.opacity * (1 - progress * 0.5) };
        } else {
          // Transition complete — clear flag
          ghostTransitionRef.current = { active: false, startMs: 0, fromGhostT: 0 };
        }
      }

      // ── 10. Phase transition logging ──────────────────────────────────────
      if (infPhase !== ghostPrevPhaseRef.current) {
        const entry: GhostLogEntry = {
          id: `${now}-${Math.random().toString(36).slice(2, 5)}`,
          time: new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2 }),
          phase: infPhase, score: Math.round(score * 100), rep: repsDone,
          detail: `${ghostPrevPhaseRef.current} → ${infPhase} | score=${Math.round(score * 100)}% rep=${repsDone} hold=${holdRem !== null ? Math.round(holdRem) + "ms" : "n/a"}`,
        };
        ghostPrevPhaseRef.current = infPhase;
        ghostLogRef.current = [entry, ...ghostLogRef.current].slice(0, 80);
        ghostSetLogRef.current?.([...ghostLogRef.current]);
      }

      // ── 11. UI badge sync ─────────────────────────────────────────────────
      setGhostPhase(anim.badgePhase);
      setGhostHoldMs(anim.holdElapsedMs);

      // ── 12. DRAW — dispatch to the correct draw function for this exercise ─
      // getGhostConfig() already ran above. dispatchGhostDraw() reads drawMode
      // and calls the right function. Zero exercise branching here.
      const { r, g, b } = anim.colorRGB;
      const physioTargetDeg = (ghostPrescriptionRef.current as any)?.romTargetDegrees
        ?? ghostPrescriptionRef.current?.targetThreshold
        ?? null;

      if (frontFlexion) {
        // Front view: the movement is shown on an "Example" card in the corner
        // (a side-view figure in step with the ghost's timing: demo, rise,
        // hold, lower, invite), and a short target marker beside the raised
        // arm. Painting a ghost arm over the patient looked odd.
        const target = ghostPrescriptionRef.current?.targetThreshold ?? 110;
        const metricNow = ghostActiveMetricRef.current;
        const reaching = reachRef.current;
        for (const side of config.sides) {
          if (reaching) break; // the range check isn't about the target: no markers
          if (infPhase === "lifting" || infPhase === "top" || infPhase === "holding") {
            angleBiasRef.current.add(metricNow, inferenceLoop.getWorld3D()[side]?.elevDeg ?? null,
              inferenceLoop.getFeatures()?.[side === "left" ? "leftElbowBent" : "rightElbowBent"] !== true);
          }
          const reachedNow = metricNow !== null && metricNow >= target;
          const c = coachRef.current;
          if (c.showElbowMarker) {
            const y = reachLineY(frame, side, inferenceLoop.getArmLength(side), target);
            if (y !== null) drawReachGuide(ctx, frame, side, y, reachedNow, target, W, H, now, !c.showHandTarget);
          }
          // Where the hand should reach (testers' request): green once the arm's
          // angle makes the target, or the hand is in the circle with a straight arm.
          if (c.showHandTarget) {
            // Learn: the moment the measured angle first makes the target with a
            // straight arm, note where the hand is. The circle then sits there
            // (the middle of the last few), so it matches how reps are counted
            // for this patient; until then, geometry places it.
            const bentNow = inferenceLoop.getFeatures()?.[side === "left" ? "leftElbowBent" : "rightElbowBent"] === true;
            const prev = prevMetricForHandRef.current;
            if (metricNow !== null && prev !== null && prev < target && metricNow >= target && !bentNow) {
              const off = handOffset(frame, side);
              if (off) handSamplesRef.current = [...handSamplesRef.current, off].slice(-7);
            }
            prevMetricForHandRef.current = metricNow;
            const learned = medianOffset(handSamplesRef.current);
            // Geometry alone sat too low (the measured angle reads lower than
            // the true one near the top), so it aims at the target plus the
            // learned gap to the 3D angle (AngleBias).
            const t = learned ? targetFromOffset(frame, side, learned)
              : handTargetPoint(frame, side, inferenceLoop.getArmLength(side), Math.min(175, target + angleBiasRef.current.get()));
            // Green only when the rep will count (the measured angle made it).
            if (t) drawHandTarget(ctx, side, t, reachedNow, W, H, now);
          }
        }
        // The card leads like a physio: it demonstrates while the patient is
        // at rest (once, then again only after a long pause), and during a
        // rep it mirrors the patient's own arm against the target line.
        const activeRep = infPhase === "lifting" || infPhase === "top" || infPhase === "holding" || infPhase === "lowering";
        const sideNow = config.sides[0];
        const bent = inferenceLoop.getFeatures()?.[sideNow === "left" ? "leftElbowBent" : "rightElbowBent"];
        const plane = inferenceLoop.getFeatures()?.[sideNow === "left" ? "leftArmPlaneDeg" : "rightArmPlaneDeg"];
        const holdLeft = ghostHoldRemRef.current;
        const wrongArm = repCoachRef.current.wrongArmNow;
        const wrongPathNow = activeRep && pathSidewaysNow();
        const wrongPlaneNow = wrongPathNow || (activeRep && plane !== null && plane !== undefined && plane > maxPlaneNow());
        // Label the arm to use: before the first rep, and loudly on the wrong arm.
        if (config.sides.length === 1 && (wrongArm || (repsDone === 0 && (infPhase === "ready" || infPhase === "lifting")))) {
          drawArmLabel(ctx, frame, sideNow, W, H, wrongArm, now);
        }
        // The guide's viewing angle: side on at the start of a demonstration,
        // turning to three-quarter (55°) as it raises the arm; facing the
        // patient (25°) to show "in front of you" when they go out to the side.
        const sinceReady = (now - ghostReadyStartRef.current) / 1000;
        const clockNow = infPhase === "ready" ? demoClock(repsDone === 0 ? sinceReady : sinceReady - BETWEEN_REPS_REST_S) : null;
        // The rest of the time it walks slowly round the patient, from
        // three-quarter (62°) to nearly facing them (18°) and back over
        // GUIDE_ORBIT_S, like a physio showing the movement from different
        // angles (the owner's testers' request); smoothed, so it never jumps.
        const orbit = orbitYaw(coachRef.current, now / 1000);
        const yawTarget = wrongPlaneNow ? 25
          : clockNow && clockNow.t < 2 ? 90 - (90 - orbit) * (clockNow.t / 2)
          : orbit;
        guideYawRef.current += (yawTarget - guideYawRef.current) * 0.05;
        // Seated or standing like the patient (kept when the legs are hidden).
        // Steady, not per frame: the reading flickers when the legs are half
        // hidden (lib/pose/postureLatch.ts).
        const featsNow = inferenceLoop.getFeatures();
        postureLatchRef.current ??= new PostureLatch(ghostPrescriptionRef.current?.posture === "standing" ? "standing" : "seated", coachRef.current.postureSwitchSeconds * 1000);
        // The leg reading, except at the top (a held, leaning trunk shifts the
        // hips). With the legs out of the picture the guide keeps its posture:
        // v0.11.0 guessed from the shoulders, and leaning toward a laptop read
        // as standing up (the owner's run).
        const legsNow = infPhase !== "top" && infPhase !== "holding"
          ? (featsNow?.isSeated ? "seated" : featsNow?.isStanding ? "standing" : "unknown")
          : "unknown";
        const seatedNow = postureLatchRef.current.update(legsNow, snapNow) === "seated";
        const caption =
          reaching ? (reaching.stage === "hold" ? "Hold it there" : reaching.stage === "down" ? "Slowly down" : "As high as is comfortable")
          : wrongArm ? `Use your ${sideNow} arm`
          : wrongPathNow ? "Lower, then lift in front"
          : wrongPlaneNow ? "Arm in front of you"
          : activeRep && bent && infPhase !== "lowering" ? "Keep your arm straight"
          : infPhase === "holding" || infPhase === "top"
            ? (holdLeft !== null ? `Hold… ${Math.max(1, Math.ceil(holdLeft / 1000))}` : "Hold it there")
          : infPhase === "lowering" ? "Lower slowly"
          : infPhase === "lifting" ? (metricNow !== null && metricNow < target ? "Higher…" : "That's it")
          : liftCaption(target); // plain words, not degrees (lib/coaching/plainHeight.ts)
        const gc = guideCanvasRef.current;
        const gctx = gc?.getContext("2d") ?? null;
        const GW = 600, GH = 660;
        if (gc && (gc.width !== GW || gc.height !== GH)) { gc.width = GW; gc.height = GH; }
        gctx?.clearRect(0, 0, GW, GH);
        if (gctx) drawExampleCard({
          ctx: gctx, W: GW, H: GH, full: true,
          armDeg: (activeRep || reaching) && metricNow !== null ? Math.max(0, Math.min(180, metricNow)) : anim.ghostT * target,
          targetDeg: target,
          seated: seatedNow,
          side: (ghostPrescriptionRef.current?.side ?? "right") as "right" | "left" | "both",
          yawDeg: guideYawRef.current,
          caption,
          rgb: { r: 96, g: 190, b: 250 },
          corner: config.sides.includes("right") ? "bottom-left" : "bottom-right",
        });
      } else dispatchGhostDraw({
        ctx,
        config,
        lms: lms as any,
        ghostT:          anim.ghostT,
        opacity:         anim.opacity,
        colorRGB:        { r, g, b },
        W, H,
        shoulderWidthPx: ghostSmoothedSW.current,
        torsoLenPx:      ghostSmoothedTorso.current,
        physioTargetDeg,
      });

      // ── 13. ROM score ring (top-left) ─────────────────────────────────────
      // Always shown: the owner relies on the percentage to see compliance at a
      // glance (v0.8.2 hid it with the guide in its own panel; restored v0.8.4).
      {
        const romPct    = score;
        const romRadius = Math.min(W, H) * 0.13;
        const romStrokeW = romRadius * 0.14;
        const romCx = romRadius + romStrokeW * 2 + 12;
        const romCy = romRadius + romStrokeW * 2 + 12;
        const isActivePhase = infPhase === "lifting" || infPhase === "holding" || infPhase === "lowering";
        const ringOpacity   = isActivePhase ? 1.0 : 0.35;
        const rRom = romPct < 0.5 ? 210 : Math.floor(210 + (63  - 210) * ((romPct - 0.5) / 0.5));
        const gRom = romPct < 0.5 ? Math.floor(100 + (185 - 100) * (romPct / 0.5)) : Math.floor(185 + (222 - 185) * ((romPct - 0.5) / 0.5));
        const bRom = romPct < 0.5 ? 34 : Math.floor(34 + (128 - 34) * ((romPct - 0.5) / 0.5));
        const ringColor = `rgba(${rRom},${gRom},${bRom},${ringOpacity})`;
        ctx.save();
        ctx.globalAlpha = ringOpacity;
        ctx.beginPath(); ctx.arc(romCx, romCy, romRadius + romStrokeW * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,20,0.80)"; ctx.fill();
        ctx.beginPath(); ctx.arc(romCx, romCy, romRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = romStrokeW; ctx.lineCap = "round"; ctx.stroke();
        if (romPct > 0) {
          ctx.beginPath(); ctx.arc(romCx, romCy, romRadius, -Math.PI / 2, -Math.PI / 2 + romPct * Math.PI * 2);
          ctx.strokeStyle = ringColor; ctx.lineWidth = romStrokeW; ctx.lineCap = "round"; ctx.stroke();
        }
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff";
        ctx.font = `800 ${Math.round(romRadius * 0.72)}px system-ui, sans-serif`;
        ctx.fillText(`${Math.round(romPct * 100)}`, romCx, romCy - romRadius * 0.18);
        const phaseLabel = (() => {
          if (!sessionQueue.sessionStarted) return "ROM %";
          switch (infPhase) {
            case "lifting":  return "Raise ↑";
            case "holding":  return "Hold";
            case "lowering": return "Lower ↓";
            case "ready":    return "Ready";
            case "complete": return "Done ✓";
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

      // ── 14. Hold countdown ring (top-right) ───────────────────────────────
      if (anim.isHolding) {
        const pct       = Math.min(1, anim.holdElapsedMs / holdTotal);
        const remaining = Math.max(0, Math.ceil((holdTotal - anim.holdElapsedMs) / 1000));
        const radius    = Math.min(W, H) * 0.13;
        const strokeW   = radius * 0.14;
        const cx = W - radius - strokeW * 2 - 12;
        const cy = radius + strokeW * 2 + 12;
        ctx.beginPath(); ctx.arc(cx, cy, radius + strokeW * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,12,20,0.80)"; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = strokeW; ctx.lineCap = "round"; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.strokeStyle = "#4ade80"; ctx.lineWidth = strokeW; ctx.lineCap = "round"; ctx.stroke();
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff";
        ctx.font = `800 ${Math.round(radius * 0.85)}px system-ui, sans-serif`;
        ctx.fillText(String(remaining), cx, cy - radius * 0.08);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = `600 ${Math.round(radius * 0.28)}px system-ui, sans-serif`;
        ctx.fillText("HOLD", cx, cy + radius * 0.45);
      }

      // ── 15. Live skeleton overlay ─────────────────────────────────────────
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
    setIsPaused(false);
    videoElementRef.current = null;
    // Flush debug log on every camera stop — catches navigate-away and manual end
    flushDebugLogToSupabase("session_end");
  }

  function pauseSession() {
    if (!sessionQueue.sessionStarted || isPaused) return;
    setIsPaused(true);
    inferenceLoop.stopLoop();
    cancelAnimationFrame(ghostAnimRef.current);
    window.speechSynthesis?.cancel();
    coachingBrain.setVoiceEnabled(false);
    framingIntelligence.cancelPendingEval();
    flushDebugLogToSupabase("pause");
    writeDebugLog("info", "SESSION", "Paused");
  }

  function resumeSession() {
    if (!isPaused) return;
    const video = videoElementRef.current;
    if (!video) { writeDebugLog("error", "SESSION", "Resume failed — no video element"); return; }
    setIsPaused(false);
    lastSeenMsRef.current = Date.now();
    presenceRef.current.reset(Date.now());
    coachingBrain.setVoiceEnabled(voiceOn);
    inferenceLoop.startLoop(video, sessionQueue.getActivePrescription, handleExerciseComplete, stableCoachingCallbacks, framingCallbacks, readinessEvaluator);
    startGhostLoop();
    writeDebugLog("info", "SESSION", "Resumed");
  }

  async function endSession(partial = false, mode: { status: "paused" | "completed"; reason?: string } = { status: "paused", reason: "ended" }) {
    endModeRef.current = mode;
    setEndDialog(false);
    setAway({ kind: "present" });
    if (partial && sessionQueue.sessionStarted) {
      await writeSessionResults(true);
      flushDebugLogToSupabase("session_end");
    }
    cameraRef.current?.stopCamera();
  }

  pauseRef.current = pauseSession;
  endRef.current = (partial, mode) => { void endSession(partial, mode); };

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

  // Before Begin Session, with a protocol loaded: a welcome screen (the plan
  // on the left, what to do and a big Begin button on the camera) instead of
  // "Camera is off" and "No active exercise" (the owner's report, v0.6.1).
  const welcomeOnScreen = !sessionQueue.sessionStarted && combinedQueue.length > 0;
  const canBegin = combinedQueue.length > 0 && inferenceLoop.engineStatus !== "running" && inferenceLoop.engineStatus !== "loading";
  const currentPrescription = sessionQueue.currentPrescription;
  // This exercise's tolerances: the patient's (set when assigned), else the
  // clinic's Coach Lab defaults. Applied whenever the exercise changes.
  useEffect(() => {
    const t = effectiveTolerances(currentPrescription?.tolerances, coach);
    setMaxPlaneDeg(t.sidewaysAllowanceDeg);
    setHoldSlipMs(t.holdSlipSeconds * 1000);
  }, [currentPrescription?.id, currentPrescription?.tolerances, coach]);
  const currentQueueItem = sessionQueue.currentQueueItem;
  const { framingPanelState } = framingIntelligence;
  const { panelState: coachingPanelState } = coachingBrain;

    const holdLine = currentPrescription?.hold.required
    ? " Hold each rep for " + Math.round((currentPrescription.hold.durationMs ?? 0) / 1000) + "s."
    : "";
  // ── What the camera panel shows (one thing at a time) ─────────────────
  // Positioning: until the patient is placed and still, before the first rep.
  const positioningOnScreen =
    !!framingIntelligence.positionGuide &&
    framingIntelligence.positionGuide.state !== "locked" &&
    (sessionPhase === "framing" || sessionPhase === "running") &&
    inferenceLoop.repCount === 0;
  // The exercise layer (skeleton, ghost demo): only once running and placed.
  const exerciseOnScreen = sessionPhase === "running" && !positioningOnScreen;

  const instructionBody = currentPrescription
    ? getExerciseRequirement(currentPrescription.id) + " Target: " + currentPrescription.repTarget + " rep(s)." + holdLine
    : "Choose a session and begin when ready.";

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div style={{ marginTop: 12, fontFamily: "system-ui, sans-serif" }}>

      {/* ── ROW 1: HEADER ──
          Only what isn't on the screen below (the owner, v0.6.4): the logo, the
          assignment and build (small, for tests and logs), the AI status light,
          voice on/off, a sound test, and the session controls once running.
          The plan, patient and Begin button are in the panels. */}
      <header style={{
        background: "#141A2E",
        borderRadius: 14,
        padding: isMobile ? "10px 12px" : "10px 18px",
        border: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}>
        {/* Left: logo, then the assignment and build in small type */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: "linear-gradient(135deg, #6C63FF 0%, #4A90D9 60%, #00C2C7 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M9 2L4 9H8L7 14L12 7H8L9 2Z" fill="white" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "white", letterSpacing: -0.4 }}>
              Reha<span style={{ color: "#4FB6E0" }}>bly</span>
            </div>
          </div>
          {!isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "monospace", color: "#6B7598" }}>
              {prescriptionId && (
                <button
                  title="Assignment ID: click to copy the full ID"
                  onClick={() => copyToClipboard(prescriptionId)}
                  style={{ font: "inherit", color: "inherit", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}
                >
                  {assignmentCode(prescriptionId)}
                </button>
              )}
              <span>{versionLabel()}</span>
            </div>
          )}
        </div>

        {/* Right: status and controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* AI status light: green (steady glow) connected, red blinking not
              connected, amber checking. Click to check again. */}
          {(() => {
            const st = aiEngineStatus;
            const led = st === "ok" ? "#3FB950" : st === "error" ? "#F85149" : st === "checking" ? "#F0B429" : "#6B7598";
            const label = st === "ok" ? "AI connected" : st === "error" ? "AI offline" : st === "checking" ? "Checking AI…" : "AI not checked";
            return (
              <button
                onClick={() => checkAiEngine(false)}
                title={`${label}. Click to check again.${st === "error" ? " Coaching still works with built-in phrases." : ""}`}
                aria-label={`${label}. Check again`}
                style={{
                  display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px",
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18,
                  color: "#C9D2EE", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                <span aria-hidden="true" style={{
                  width: 10, height: 10, borderRadius: 5, background: led,
                  boxShadow: st === "ok" || st === "error" ? `0 0 8px ${led}` : "none",
                  animation: st === "error" ? "ledBlink 1s ease-in-out infinite" : st === "ok" ? "ledGlow 2.4s ease-in-out infinite" : st === "checking" ? "pulse 1s infinite" : "none",
                }} />
                AI
              </button>
            );
          })()}

          {/* Voice on / off */}
          <button
            onClick={handleVoiceToggle}
            aria-pressed={voiceOn}
            title={voiceOn ? "Voice coaching is on. Click to mute." : "Voice coaching is muted. Click to turn it on."}
            style={{
              display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px",
              background: voiceOn ? "rgba(63,185,80,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${voiceOn ? "rgba(63,185,80,0.35)" : "rgba(255,255,255,0.08)"}`, borderRadius: 18,
              color: voiceOn ? "#9be7b0" : "#AEB8D6", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {voiceOn ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="M23 9l-6 6M17 9l6 6" />}
            </svg>
            {voiceOn ? "Voice on" : "Muted"}
          </button>

          {/* Sound test: says one line through the same voice */}
          <button
            onClick={() => {
              if (typeof window === "undefined" || !window.speechSynthesis) return;
              window.speechSynthesis.cancel();
              const utt = new SpeechSynthesisUtterance(voiceOn ? "Hello, I'm your coach. If you can hear me, your sound is working." : "Voice is muted. Turn the voice on to hear me.");
              utt.rate = coachRef.current.voiceRate;
              const pref = window.speechSynthesis.getVoices().find(v => v.lang.startsWith("en") && /Natural|Neural|Premium|Samantha|Karen|Daniel/.test(v.name));
              if (pref) utt.voice = pref;
              window.speechSynthesis.speak(utt);
              writeDebugLog("info", "VOICE", "Sound test");
            }}
            title="Play a short line to check your speakers"
            style={{
              height: 36, padding: "0 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18, color: "#C9D2EE", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Test sound
          </button>

          {/* In session: time, pause / resume, end, restart */}
          {sessionQueue.sessionStarted && (
            <>
              <span aria-hidden="true" style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
              <div style={{
                display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 14px", borderRadius: 18,
                background: isPaused ? "rgba(240,180,41,0.1)" : "rgba(63,185,80,0.1)",
              }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: isPaused ? "#F0B429" : "#3FB950", animation: isPaused ? "none" : "pulse 2s infinite" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: isPaused ? "#ffcc80" : "#9be7b0" }}>{isPaused ? "Paused" : "In session"}</span>
                <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "white", letterSpacing: 1 }}>{sessionTimer}</span>
              </div>
              {isPaused ? (
                <button onClick={resumeSession} style={{
                  height: 36, padding: "0 16px", borderRadius: 18, border: "none", cursor: "pointer",
                  background: "#3FB950", color: "#08240F", fontSize: 13, fontWeight: 800,
                }}>Resume</button>
              ) : (
                <button onClick={pauseSession} style={{
                  height: 36, padding: "0 16px", borderRadius: 18, cursor: "pointer",
                  background: "rgba(240,180,41,0.12)", color: "#ffcc80", border: "1px solid rgba(240,180,41,0.3)", fontSize: 13, fontWeight: 700,
                }}>Pause</button>
              )}
              <button onClick={() => setEndDialog(true)} style={{
                height: 36, padding: "0 16px", borderRadius: 18, cursor: "pointer",
                background: "rgba(255,255,255,0.06)", color: "#EEF2FF", border: "1px solid rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 700,
              }}>End session</button>
              <button onClick={resetSession} title="Start this session again from the beginning" style={{
                height: 36, padding: "0 10px", borderRadius: 18, cursor: "pointer",
                background: "transparent", color: "#8892B4", border: "none", fontSize: 13,
              }}>Restart</button>
            </>
          )}
        </div>
      </header>

      {/* ── ROW 2: THE EXERCISE SCREEN (read from 2-3 m) ──
          The guide in its own panel on the left, the camera large on the
          right (the owner's request: at home, once placed far enough back to
          be measured, patients could not see the small camera view). The
          coaching, Camera Sees, session details and logs stay underneath for
          now (the owner, 2026-11-26). */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile || isPortrait ? "1fr" : "minmax(300px,2fr) minmax(0,3fr)",
        gap: 16,
        alignItems: "stretch",
        marginBottom: 16,
      }}>

        {/* LEFT: the guide */}
        <section aria-label="Your guide" style={{
          position: "relative",
          background: "#141A2E", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)",
          padding: 12, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: isMobile || isPortrait ? 0 : 360,
        }}>
          {/* Walked away: the coach says so, counts down, and offers "I'm back". */}
          {(away.kind === "paused" || away.kind === "countdown") && (
            <div role="alert" style={{
              position: "absolute", inset: 0, zIndex: 5, borderRadius: 16, background: "#141A2E",
              display: "flex", flexDirection: "column", justifyContent: "center", gap: isMobile ? 12 : 20, padding: isMobile ? 16 : 28,
            }}>
              <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF" }}>YOUR COACH</div>
              <div style={{ background: away.kind === "countdown" ? "#F0B429" : "#58a6ff", color: away.kind === "countdown" ? "#1A1200" : "#04162E", borderRadius: 20, padding: isMobile ? "14px 16px" : "22px 24px" }}>
                <div style={{ fontSize: isMobile ? 22 : "clamp(26px, 2.4vw, 38px)", fontWeight: 800, lineHeight: 1.15 }}>
                  {away.kind === "countdown" ? `Saving and closing in ${away.secondsLeft}…` : "I can't see you. Your session is paused."}
                </div>
              </div>
              <div style={{ fontSize: isMobile ? 17 : 22, color: "#C9D2EE", lineHeight: 1.35 }}>
                Step back in front of the camera to carry on.{away.kind === "countdown" ? " Your progress will be saved, and you can finish later today." : ""}
              </div>
              <button onClick={imBack} style={{
                alignSelf: "flex-start", background: "#3FB950", color: "#08240F", border: "none", borderRadius: 16,
                padding: isMobile ? "12px 24px" : "16px 34px", fontSize: isMobile ? 18 : 24, fontWeight: 800, cursor: "pointer",
              }}>
                I'm back
              </button>
            </div>
          )}
          {/* Side by side, the panel takes the camera's height (its content sits
              in a box that doesn't stretch the row, and scrolls if it must);
              stacked, it flows. */}
          <div style={stacked ? { display: "flex", flexDirection: "column", gap: 0 } : {
            position: "absolute", inset: 12, display: "flex", flexDirection: "column", justifyContent: "center", overflowY: "auto",
          }}>
          {/* Where the patient is in the protocol (any number of exercises). */}
          {sessionQueue.sessionStarted && fullQueue.length > 0 && (() => {
            const qi = Math.min(fullIndexOf(sessionQueue.queueIndex), fullQueue.length - 1);
            const nextRun = combinedQueue[sessionQueue.queueIndex + 1];
            const next = nextRun ?? null;
            const nm = (it: typeof combinedQueue[number]) => (it.prescription as any)?.clinicalName ?? it.displayName;
            return (
              <div style={{ padding: isMobile ? "4px 8px 8px" : "4px 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontSize: isMobile ? 12 : 14, fontWeight: 700, letterSpacing: "0.08em", color: "#AEB8D6" }}>
                    EXERCISE {qi + 1} OF {fullQueue.length}
                  </span>
                  {next && <span style={{ fontSize: isMobile ? 12 : 14, color: "#8892B4", textAlign: "right" }}>Next: {nm(next)}</span>}
                </div>
                <div role="img" aria-label={`Exercise ${qi + 1} of ${fullQueue.length}`} style={{ display: "flex", gap: 4 }}>
                  {fullQueue.map((it, i) => (
                    <span key={`${it.id}-${i}`} title={nm(it)} style={{
                      flex: 1, height: 6, borderRadius: 3,
                      background: doneIdx.includes(i) ? "#3FB950" : i === qi ? "#9DB8FF" : "#2A3352",
                    }} />
                  ))}
                </div>
              </div>
            );
          })()}
          <canvas
            ref={guideCanvasRef}
            width={600} height={660}
            aria-label="Your guide showing the movement"
            style={{
              width: "100%", height: stacked ? "34vh" : "auto", flex: stacked ? undefined : "1 1 0", minHeight: 0,
              objectFit: "contain", display: guideInPanel && exerciseOnScreen ? "block" : "none",
            }}
          />
          {welcomeOnScreen && (
            <div style={{ padding: isMobile ? 8 : 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF" }}>
                {patientName ? `GOOD ${new Date().getHours() < 12 ? "MORNING" : new Date().getHours() < 17 ? "AFTERNOON" : "EVENING"}, ${patientName.split(" ")[0].toUpperCase()}` : "WELCOME"}
              </div>
              <div style={{ fontSize: isMobile ? 24 : 34, fontWeight: 800, lineHeight: 1.15, color: "white" }}>
                {resume.resumable ? "Welcome back" : (sessionTitle ?? "Today's exercises")}
              </div>
              <div style={{ fontSize: isMobile ? 14 : 17, fontWeight: 700, color: resume.resumable ? "#9be7b0" : "#AEB8D6" }}>
                {resume.resumable
                  ? `You finished ${resume.done.length} of ${fullQueue.length} exercise${fullQueue.length !== 1 ? "s" : ""} earlier today.`
                  : `${combinedQueue.length === 1 ? "1 exercise" : `${combinedQueue.length} exercises`} · ${formatDurationRange(combinedDurationSeconds)}`}
              </div>
              <ol style={{
                margin: 0, padding: "0 4px 0 0", listStyle: "none", display: "flex", flexDirection: "column",
                gap: combinedQueue.length > 4 ? 8 : 12, maxHeight: isMobile ? "30vh" : "44vh", overflowY: "auto",
              }}>
                {fullQueue.map((item, i) => {
                  const p = item.prescription as any;
                  const target = p.romTargetDegrees ?? p.targetThreshold ?? null;
                  const wasDone = resume.resumable && resume.done.includes(i);
                  const hold = p.hold?.required && p.hold?.durationMs ? Math.round(p.hold.durationMs / 1000) : null;
                  return (
                    <li key={`${item.id}-${i}`} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <span aria-label={wasDone ? "done" : undefined} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 18, background: wasDone ? "#3FB950" : "#2A3352", color: wasDone ? "#08240F" : "#C9D2EE", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{wasDone ? "✓" : i + 1}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: "white" }}>{p.clinicalName ?? item.displayName}</span>
                        <span style={{ fontSize: isMobile ? 15 : 18, color: "#AEB8D6" }}>
                          {[`${p.repTarget} reps`, hold ? `hold ${hold} s` : null, targetPhrase(p.target?.metric, target)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {/* The coach, while the patient gets into place: the ONE instruction
              (big, coloured by state), the setup line, a checklist of what is
              already right, and what comes next. The camera keeps only the
              outline and an arrow (the owner's request: the same words were
              shown in three places). */}
          {/* The coach greets the patient (it is the coach speaking, so it is
              shown here, not on the camera), then confirms they are placed. */}
          {!welcomeOnScreen && sessionPhase === "greeting" && (
            <div style={{ padding: isMobile ? 8 : 16, display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>
              <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF", display: "flex", alignItems: "center", gap: 12 }}>
                <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 3, height: 20 }}>
                  {[0.4, 0.8, 1.0, 0.6, 0.9].map((h, i) => (
                    <span key={i} style={{ width: 4, borderRadius: 2, background: "#9DB8FF", height: `${h * 100}%`, animation: "wave 1.2s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
                YOUR COACH
              </div>
              <div style={{ fontSize: isMobile ? 26 : "clamp(30px, 2.8vw, 44px)", fontWeight: 800, lineHeight: 1.15, color: "white" }}>
                {patientName ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${patientName.split(" ")[0]}` : "Welcome"}
              </div>
              <div aria-live="polite" style={{ fontSize: isMobile ? 18 : "clamp(20px, 1.7vw, 26px)", color: "#C9D2EE", lineHeight: 1.4 }}>
                {greetingCaption ?? "One moment…"}
              </div>
              {previousSession && (
                <div style={{ fontSize: isMobile ? 14 : 17, color: "#AEB8D6" }}>
                  Last time: {previousSession.sessionTitle}
                </div>
              )}
            </div>
          )}
          {!welcomeOnScreen && sessionPhase === "confirmed" && (
            <div style={{ padding: isMobile ? 8 : 16, display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF" }}>YOUR COACH</div>
              <div style={{ background: "#3FB950", color: "#08240F", borderRadius: 20, padding: isMobile ? "14px 16px" : "22px 24px", fontSize: isMobile ? 22 : "clamp(26px, 2.4vw, 38px)", fontWeight: 800, lineHeight: 1.15 }}>
                Perfect, I can see you clearly. Let's begin.
              </div>
            </div>
          )}
          {!welcomeOnScreen && positioningOnScreen && framingIntelligence.positionGuide && (() => {
            const g = framingIntelligence.positionGuide;
            const col = POSITION_COLOR[g.state];
            const ink = g.state === "adjusting" ? "#1A1200" : g.state === "hold_still" ? "#04162E" : "#08240F";
            const arrow = g.issue?.arrow ?? null;
            const steps = positioningSteps(g.issue?.id ?? null, g.state === "locked");
            const first = combinedQueue[sessionQueue.queueIndex] ?? combinedQueue[0];
            return (
              <div style={{ padding: isMobile ? 8 : 16, display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>
                <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF" }}>
                  YOUR COACH · GETTING YOU IN PLACE
                </div>
                <div aria-live="polite" style={{
                  background: col, color: ink, borderRadius: 20, padding: isMobile ? "14px 16px" : "22px 24px",
                  display: "flex", alignItems: "center", gap: 18,
                }}>
                  {arrow && (
                    <span aria-hidden="true" style={{
                      flexShrink: 0, width: isMobile ? 48 : 68, height: isMobile ? 48 : 68, borderRadius: 40,
                      background: "rgba(0,0,0,0.14)", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: isMobile ? 28 : 40,
                    }}>{POSITION_ICON[arrow]}</span>
                  )}
                  <span style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: isMobile ? 22 : "clamp(26px, 2.4vw, 38px)", fontWeight: 800, lineHeight: 1.15 }}>
                      {g.issue?.say ?? (g.state === "locked" ? "Perfect. Stay just like that." : "Fit yourself inside the outline.")}
                    </span>
                    {g.state === "hold_still" && (
                      <span style={{ height: 10, borderRadius: 5, background: "rgba(0,0,0,0.18)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.round(g.progress * 100)}%`, background: ink, transition: "width 0.3s linear" }} />
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ fontSize: isMobile ? 16 : 20, color: "#C9D2EE", lineHeight: 1.35 }}>{g.setupLine}</div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: isMobile ? 8 : 12 }}>
                  {steps.map((st) => (
                    <li key={st.key} style={{
                      display: "flex", alignItems: "center", gap: 14,
                      fontSize: isMobile ? 16 : 21, fontWeight: st.status === "now" ? 800 : 600,
                      color: st.status === "done" ? "#9be7b0" : st.status === "now" ? "#FFFFFF" : "#6B7598",
                    }}>
                      <span aria-hidden="true" style={{
                        flexShrink: 0, width: 30, height: 30, borderRadius: 15, boxSizing: "border-box",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 900,
                        background: st.status === "done" ? "#3FB950" : "transparent",
                        color: "#08240F",
                        border: st.status === "done" ? "none" : `3px solid ${st.status === "now" ? col : "#3A4466"}`,
                      }}>{st.status === "done" ? "✓" : ""}</span>
                      <span>{st.label}<span style={{ position: "absolute", left: -9999 }}>{st.status === "done" ? " (done)" : st.status === "now" ? " (now)" : ""}</span></span>
                    </li>
                  ))}
                </ul>
                {first && (
                  <div style={{ fontSize: isMobile ? 14 : 17, color: "#8892B4" }}>
                    Next: {(first.prescription as any)?.clinicalName ?? first.displayName}
                  </div>
                )}
              </div>
            );
          })()}
          {!welcomeOnScreen && !positioningOnScreen && sessionPhase !== "greeting" && sessionPhase !== "confirmed" && !(guideInPanel && exerciseOnScreen) && (
            <div style={{ padding: isMobile ? 8 : 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF" }}>
                {positioningOnScreen ? "LET'S GET YOU IN PLACE" : "YOUR EXERCISE"}
              </div>
              <div style={{ fontSize: isMobile ? 24 : 34, fontWeight: 800, lineHeight: 1.15, color: "white" }}>
                {(currentQueueItem?.prescription as any)?.clinicalName ?? currentQueueItem?.displayName ?? "Your session"}
              </div>
              <div style={{ fontSize: isMobile ? 17 : 22, color: "#C9D2EE", lineHeight: 1.4 }}>
                {positioningOnScreen ? framingPanelState.message : instructionBody}
              </div>
            </div>
          )}
          </div>
        </section>

        {/* RIGHT: Framing Intelligence Bar + Camera */}
        <div>

          {/* ── FRAMING INTELLIGENCE BAR ── (not on the welcome screen) */}
          <div style={{
            // Hidden on the welcome screen, while positioning (the coach panel
            // says it) and during the exercise (the instruction band does).
            display: welcomeOnScreen || positioningOnScreen || exerciseOnScreen || sessionPhase === "greeting" || sessionPhase === "confirmed" ? "none" : "flex",
            marginBottom: 8,
            padding: "9px 14px",
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 600,
            background: sessionPhase === "confirmed"
              ? "rgba(63,185,80,0.10)"
              : sessionPhase === "greeting"
              ? "rgba(108,99,255,0.10)"
              : framingPanelState.tone === "good"
              ? "rgba(63,185,80,0.10)"
              : framingPanelState.tone === "critical"
              ? "rgba(248,81,73,0.10)"
              : "rgba(210,153,34,0.10)",
            border: `1px solid ${
              sessionPhase === "confirmed" ? "rgba(63,185,80,0.30)"
              : sessionPhase === "greeting" ? "rgba(108,99,255,0.30)"
              : framingPanelState.tone === "good" ? "rgba(63,185,80,0.30)"
              : framingPanelState.tone === "critical" ? "rgba(248,81,73,0.30)"
              : "rgba(210,153,34,0.30)"
            }`,
            
            alignItems: "center",
            gap: 10,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: sessionPhase === "confirmed" ? "#3fb950"
                : sessionPhase === "greeting" ? "#a78bfa"
                : framingPanelState.tone === "good" ? "#3fb950"
                : framingPanelState.tone === "critical" ? "#f85149" : "#d29922",
              boxShadow: `0 0 6px ${
                sessionPhase === "confirmed" ? "#3fb950"
                : sessionPhase === "greeting" ? "#a78bfa"
                : framingPanelState.tone === "good" ? "#3fb950"
                : framingPanelState.tone === "critical" ? "#f85149" : "#d29922"
              }`,
              animation: sessionPhase === "greeting" ? "pulse 1.5s infinite" : framingPanelState.evaluating ? "pulse 1s infinite" : "none",
            }} />
            <span style={{
              flex: 1,
              color: sessionPhase === "confirmed" ? "#9be7b0"
                : sessionPhase === "greeting" ? "#c4b5fd"
                : framingPanelState.tone === "good" ? "#9be7b0"
                : framingPanelState.tone === "critical" ? "#ff8f8f" : "#ffcc80",
            }}>
              {sessionPhase === "greeting"
                ? "Preparing your session…"
                : sessionPhase === "confirmed"
                ? "Perfect — I can see you clearly. Starting…"
                : framingPanelState.message}
            </span>
          </div>

          {/* ── CAMERA CARD ── */}
          <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>

            {/* GREETING / CONFIRMED: the coach panel does the talking; the
                camera panel only says what is happening to the camera. */}
            {(sessionPhase === "greeting" || sessionPhase === "confirmed") && (
              <div style={{
                minHeight: isMobile ? 200 : 360, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center",
              }}>
                {sessionPhase === "confirmed" ? (
                  <div aria-hidden="true" style={{ width: 96, height: 96, borderRadius: 48, background: "#3FB950", color: "#08240F", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, fontWeight: 900 }}>✓</div>
                ) : (
                  <>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#6B7598" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
                    </svg>
                    <div style={{ fontSize: isMobile ? 17 : 22, color: "#AEB8D6" }}>Your camera turns on in a moment.</div>
                  </>
                )}
              </div>
            )}

            {/* CAMERA — shown during framing and running phases */}
            <div style={{ display: sessionPhase === "greeting" || sessionPhase === "confirmed" ? "none" : "block" }}>
              <div style={{ position: "relative" }}>
                <CameraViewport ref={cameraRef} onVideoReady={handleCameraReady} onCameraStop={handleCameraStop} showStartButton={false} />
                {/* One thing at a time. While the patient is being positioned, only
                    the positioning guide shows; the skeleton and the ghost demo
                    appear once they are in place and the exercise is running. */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: exerciseOnScreen ? 0.55 : 0, transition: "opacity 0.5s ease" }}>
                  <PoseCanvasOverlay frame={inferenceLoop.frame} />
                </div>
                {/* Ghost silhouette canvas — layered on top of pose skeleton */}
                <canvas
                  ref={ghostCanvasRef}
                  width={640} height={480}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: "block", opacity: exerciseOnScreen ? 1 : 0, transition: "opacity 0.5s ease" }}
                />
                {/* Positioning coach: until the patient is placed and still (before the first rep) */}
                {positioningOnScreen && <PositionGuideOverlay guide={framingIntelligence.positionGuide!} textInPanel />}
                {welcomeOnScreen && (
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: 18, background: "#141A2E", overflowY: "auto",
                    display: "flex", flexDirection: "column", justifyContent: isMobile ? "flex-start" : "center", gap: isMobile ? 12 : 20,
                    padding: isMobile ? 16 : "24px 40px",
                  }}>
                    <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "#9DB8FF" }}>BEFORE YOU START</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: isMobile ? 8 : 14 }}>
                      {[
                        "Put the screen where you can see it, with the camera facing you.",
                        "Sit on a firm chair, 2 to 3 metres back, so your whole body is in view.",
                        "Leave room above your head to raise your arms.",
                        "Turn the sound up: I'll talk you through each exercise.",
                      ].map((t, i) => (
                        <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: isMobile ? 16 : "clamp(18px, 1.6vw, 24px)", color: "#EEF2FF", lineHeight: 1.3 }}>
                          <span style={{ flexShrink: 0, width: 10, height: 10, borderRadius: 5, background: "#3FB950", marginTop: "0.45em" }} />
                          {t}
                        </li>
                      ))}
                    </ul>
                    {resume.resumable ? (
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                        <button onClick={continueSession} disabled={!canBegin} style={{
                          background: canBegin ? "#3FB950" : "rgba(63,185,80,0.2)", color: canBegin ? "#08240F" : "#7a88a8",
                          border: "none", borderRadius: 16, padding: isMobile ? "14px 28px" : "18px 40px",
                          fontSize: isMobile ? 20 : 28, fontWeight: 800, cursor: canBegin ? "pointer" : "not-allowed",
                        }}>
                          Continue
                        </button>
                        <button onClick={startOver} disabled={!canBegin} style={{
                          background: "transparent", color: "#C9D2EE", border: "2px solid #3A4466", borderRadius: 16,
                          padding: isMobile ? "12px 20px" : "16px 28px", fontSize: isMobile ? 17 : 22, fontWeight: 700,
                          cursor: canBegin ? "pointer" : "not-allowed",
                        }}>
                          Start over
                        </button>
                      </div>
                    ) : (
                    <button
                      onClick={beginCombinedSession}
                      disabled={!canBegin}
                      style={{
                        alignSelf: "flex-start", marginTop: 4,
                        background: canBegin ? "#3FB950" : "rgba(63,185,80,0.2)", color: canBegin ? "#08240F" : "#7a88a8",
                        border: "none", borderRadius: 16, padding: isMobile ? "14px 28px" : "18px 40px",
                        fontSize: isMobile ? 20 : 28, fontWeight: 800, cursor: canBegin ? "pointer" : "not-allowed",
                      }}
                    >
                      Begin session
                    </button>
                    )}
                    <div style={{ fontSize: isMobile ? 13 : 16, color: "#AEB8D6" }}>
                      {resume.resumable
                        ? `Continue starts with ${(() => { const it = fullQueue[resume.remaining[0]]; return it ? ((it.prescription as any)?.clinicalName ?? it.displayName) : "the next exercise"; })()}. Your camera turns on when you begin.`
                        : "Your camera turns on when you begin."}
                    </div>
                  </div>
                )}
                {/* Big rep count and one instruction line, readable from across the room. */}
                {exerciseOnScreen && currentPrescription && (
                  <div style={{
                    position: "absolute", top: 12, right: 12, pointerEvents: "none",
                    background: "rgba(11,16,32,0.82)", borderRadius: 16, padding: isMobile ? "6px 12px" : "10px 20px",
                    display: "flex", flexDirection: "column", alignItems: "flex-end",
                  }}>
                    <span style={{ fontSize: isMobile ? 11 : 15, fontWeight: 700, letterSpacing: "0.08em", color: "#AEB8D6" }}>REPS</span>
                    <span style={{ fontSize: isMobile ? 40 : "clamp(48px, 5vw, 88px)", fontWeight: 800, lineHeight: 1, color: "white" }}>
                      {inferenceLoop.repCount}
                      <span style={{ fontSize: "0.5em", color: "#AEB8D6" }}> / {currentPrescription.repTarget}</span>
                    </span>
                  </div>
                )}
                {/* With the guide in its own panel, its caption carries the instruction
                    and the hold count; the camera stays clear (the owner). */}
                {exerciseOnScreen && !guideInPanel && (() => {
                  const holding = inferenceLoop.phase === "holding" && inferenceLoop.holdRemainingMs !== null;
                  const text = holding
                    ? `Hold it there… ${Math.max(1, Math.ceil(inferenceLoop.holdRemainingMs! / 1000))}`
                    : coachingPanelState.isThinking ? null : coachingPanelState.message;
                  if (!text) return null;
                  const tone = holding ? "encouraging" : coachingPanelState.tone;
                  const look =
                    tone === "encouraging" ? { bg: "#3FB950", fg: "#08240F" }
                    : tone === "corrective" ? { bg: "#F5A524", fg: "#1A1200" }
                    : tone === "urgent" ? { bg: "#F85149", fg: "#FFFFFF" }
                    : { bg: "#E7ECFA", fg: "#0B1020" };
                  return (
                    <div aria-live="polite" style={{
                      position: "absolute", left: 12, right: 12, bottom: 12, pointerEvents: "none",
                      background: look.bg, color: look.fg, borderRadius: 16,
                      padding: isMobile ? "10px 14px" : "16px 24px",
                      fontSize: isMobile ? 20 : "clamp(24px, 2.8vw, 46px)", fontWeight: 800, lineHeight: 1.15,
                    }}>
                      {text}
                    </div>
                  );
                })()}
              </div>
              {inferenceLoop.engineError && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "rgba(255,100,100,0.1)", color: "#ff8f8f", fontSize: 13 }}>
                  {inferenceLoop.engineError}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── ROW 2b: coaching, progress and Camera Sees, under the exercise screen ── */}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start", marginBottom: 16 }}>

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
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, marginBottom: 2, lineHeight: 1.2 }}>
              {(currentQueueItem?.prescription as any)?.clinicalName ?? currentQueueItem?.displayName
                ?? (combinedQueue[0] ? `First up: ${(combinedQueue[0].prescription as any)?.clinicalName ?? combinedQueue[0].displayName}` : "No active exercise")}
            </div>
            {currentQueueItem && (
              <div style={{ fontSize: 11, color: "#7a88a8", marginBottom: 8 }}>{currentQueueItem.displayName}</div>
            )}
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

          {/* ── EXERCISE PROGRESS ── */}
          {sessionQueue.sessionStarted && currentPrescription && (
            <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase" as const, letterSpacing: 0.8, fontWeight: 700 }}>Exercise Progress</div>
                <div style={{ fontSize: 12, color: "#7a88a8" }}>{inferenceLoop.repCount} / {currentPrescription.repTarget} reps</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={{ background: "#0d1526", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase" as const, letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Reps</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "white", lineHeight: 1 }}>
                    {inferenceLoop.repCount}<span style={{ fontSize: 13, color: "#7a88a8", fontWeight: 500 }}> / {currentPrescription.repTarget}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#7a88a8", marginTop: 4 }}>This Exercise</div>
                </div>
                {(() => {
                  const qIdx = sessionQueue.queueIndex;
                  const peaks = exercisePeakMetricsRef.current[qIdx] ?? [];
                  const avgPeak = peaks.length > 0 ? Math.round(peaks.reduce((a: number, b: number) => a + b, 0) / peaks.length) : null;
                  const liveMetric = inferenceLoop.phase !== "ready" ? inferenceLoop.activeMetricValue : null;
                  const displayVal = liveMetric !== null ? Math.round(liveMetric) : avgPeak;
                  const romTarget = (currentPrescription as any).romTargetDegrees ?? (currentPrescription as any).romAcceptableMin ?? null;
                  return (
                    <div style={{ background: "#0d1526", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase" as const, letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>ROM</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: displayVal !== null ? "#7cc6ff" : "#7a88a8", lineHeight: 1 }}>
                        {displayVal !== null ? `${displayVal}°` : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a88a8", marginTop: 4 }}>
                        {peaks.length > 0 ? "Avg Peak" : "Live"}{romTarget !== null ? ` · Target ${romTarget}°` : ""}
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const qIdx = sessionQueue.queueIndex;
                  const holds = exerciseHoldDurationsRef.current[qIdx] ?? [];
                  const avgHold = holds.length > 0 ? (holds.reduce((a: number, b: number) => a + b, 0) / holds.length / 1000).toFixed(1) : null;
                  const liveHold = inferenceLoop.phase === "holding" && inferenceLoop.holdRemainingMs !== null
                    ? Math.max(0, currentPrescription.hold.durationMs - inferenceLoop.holdRemainingMs) : null;
                  const displayVal = liveHold !== null ? (liveHold / 1000).toFixed(1) : avgHold;
                  const targetHold = currentPrescription.hold.required ? (currentPrescription.hold.durationMs / 1000).toFixed(1) : null;
                  return (
                    <div style={{ background: "#0d1526", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase" as const, letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Hold</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: inferenceLoop.phase === "holding" ? "#9be7b0" : "white", lineHeight: 1 }}>
                        {displayVal !== null ? `${displayVal}s` : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a88a8", marginTop: 4 }}>
                        {holds.length > 0 ? "Avg" : inferenceLoop.phase === "holding" ? "Live" : "—"}{targetHold !== null ? ` · Target ${targetHold}s` : ""}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Vision confidence — landmark detection quality */}
              {(() => {
                const confPct = framingIntelligence.getLandmarkConfidencePct();
                if (confPct === null) return null;
                const confColor = confPct >= 80 ? "#3fb950" : confPct >= 60 ? "#d29922" : "#f85149";
                return (
                  <div style={{ marginBottom: 10, background: "#0d1526", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase" as const, letterSpacing: 0.5, fontWeight: 700 }}>Vision Confidence</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: confColor }}>{confPct}%</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${confPct}%`, background: confColor, borderRadius: 2, transition: "width 0.5s ease" }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#484f58", marginTop: 4 }}>Landmark detection quality this exercise</div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                {[
                  { label: "Aligned",  color: "#3fb950", bg: "rgba(63,185,80,0.12)",   show: Boolean(inferenceLoop.frame?.personDetected) },
                  { label: inferenceLoop.phase === "holding" ? "Holding" : inferenceLoop.phase === "lifting" ? "Lifting" : inferenceLoop.phase === "lowering" ? "Lowering" : "Ready",
                    color: inferenceLoop.phase === "holding" ? "#9be7b0" : inferenceLoop.phase === "lifting" ? "#7cc6ff" : inferenceLoop.phase === "lowering" ? "#a78bfa" : "#7a88a8",
                    bg: inferenceLoop.phase === "holding" ? "rgba(100,220,150,0.12)" : inferenceLoop.phase === "lifting" ? "rgba(124,198,255,0.12)" : inferenceLoop.phase === "lowering" ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.06)",
                    show: true },
                  { label: "Centered", color: "#7cc6ff", bg: "rgba(124,198,255,0.12)", show: framingPanelState.tone === "good" },
                ].filter(p => p.show).map(pill => (
                  <span key={pill.label} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: pill.bg, color: pill.color, fontWeight: 600 }}>{pill.label}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── NEXT EXERCISE ── */}
          {sessionQueue.sessionStarted && (() => {
            const nextIdx = sessionQueue.queueIndex + 1;
            const queue = sessionQueue.getActiveQueue();
            const nextItem = queue[nextIdx];
            if (!nextItem) return null;
            const np = nextItem.prescription as any;
            const nextTarget = np.romTargetDegrees ?? np.romAcceptableMin ?? null;
            const nextHold = nextItem.prescription.hold.required ? ` · ${nextItem.prescription.hold.durationMs / 1000}s hold` : "";
            return (
              <div style={{ background: "#1a2040", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase" as const, letterSpacing: 0.8, fontWeight: 700, marginBottom: 10 }}>Next Exercise</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, background: "rgba(124,198,255,0.1)", border: "1px solid rgba(124,198,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#7cc6ff" }}>
                    {nextIdx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{(nextItem.prescription as any).clinicalName ?? nextItem.displayName}</div>
                    <div style={{ fontSize: 11, color: "#7a88a8", marginTop: 1 }}>{nextItem.displayName}</div>
                    <div style={{ fontSize: 12, color: "#7a88a8", marginTop: 2 }}>
                      {nextItem.prescription.repTarget} reps{nextHold}
                      {nextTarget !== null && <span style={{ color: "#d29922" }}> · Target {nextTarget}°</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}


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

      {/* ── ROW 3: SESSION DETAILS TABLE ── */}
      {combinedQueue.length > 0 && (
        <div style={{ background: "#1a2040", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 12, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Session Details &amp; Performance</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {combinedGoal && <span style={{ fontSize: 12, color: "#7a88a8" }}>{combinedGoal}</span>}
              <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(124,198,255,0.08)", color: "#7cc6ff", fontWeight: 600 }}>
                {combinedTotalReps} reps total
              </span>
            </div>
          </div>

          {/* Table — scrollable on mobile */}
          <div style={{ overflowX: "auto" as const }}>
            <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["#", "Exercise", "ROM Target", "Push Target", "Peak ROM", "Sets", "Avg ROM", "Avg Hold", "Confidence"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left" as const, fontSize: 10, fontWeight: 700, color: "#7a88a8", textTransform: "uppercase" as const, letterSpacing: 0.5, whiteSpace: "nowrap" as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {combinedQueue.map((item, i) => {
                  const p = item.prescription as any;
                  const romTarget   = p.romTargetDegrees ?? p.romAcceptableMin ?? null;
                  const encourage   = p.encourageThreshold ?? null;
                  const isActive    = sessionQueue.sessionStarted && sessionQueue.queueIndex === i;
                  const isPast      = sessionQueue.sessionStarted && sessionQueue.queueIndex > i;
                  const repsCompleted = isActive ? inferenceLoop.repCount : isPast ? item.prescription.repTarget : 0;
                  const completionRate = item.prescription.repTarget > 0 ? repsCompleted / item.prescription.repTarget : 0;

                  // ROM accumulators
                  const peakMetrics = exercisePeakMetricsRef.current[i] ?? [];
                  const maxPeak  = peakMetrics.length > 0 ? Math.max(...peakMetrics) : null;
                  const avgPeak  = peakMetrics.length > 0 ? Math.round(peakMetrics.reduce((a: number, b: number) => a + b, 0) / peakMetrics.length) : null;
                  const holds    = exerciseHoldDurationsRef.current[i] ?? [];
                  const avgHold  = holds.length > 0 ? (holds.reduce((a: number, b: number) => a + b, 0) / holds.length / 1000).toFixed(1) : null;
                  const confPct  = exerciseLandmarkConfidenceRef.current[i] ?? null;
                  const liveConf = isActive ? framingIntelligence.getLandmarkConfidencePct() : null;
                  const confVal  = confPct ?? liveConf;
                  const confColor = confVal !== null ? (confVal >= 80 ? "#3fb950" : confVal >= 60 ? "#d29922" : "#f85149") : "#484f58";

                  return (
                    <React.Fragment key={i}>
                    <tr style={{
                      borderBottom: i < combinedQueue.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      background: isActive ? "rgba(124,198,255,0.04)" : "transparent",
                    }}>
                      {/* # */}
                      <td style={{ padding: "12px 14px", color: "#7a88a8", fontWeight: 600 }}>{i + 1}</td>

                      {/* Exercise */}
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                          <div>
                            <span style={{ fontWeight: 600, color: "white" }}>
                              {(item.prescription as any).clinicalName ?? item.displayName}
                            </span>
                            <div style={{ fontSize: 10, color: "#7a88a8", marginTop: 1 }}>
                              {item.displayName}
                            </div>
                          </div>
                          {isActive && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: "rgba(124,198,255,0.15)", color: "#7cc6ff", fontWeight: 700, flexShrink: 0 }}>Active</span>}
                        </div>
                      </td>

                      {/* ROM Target */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {romTarget !== null ? (
                          <div>
                            <div style={{ fontWeight: 700, color: "#d29922" }}>{romTarget}°</div>
                            <div style={{ fontSize: 10, color: "#7a88a8" }}>
                              {item.prescription.repTarget} reps·{item.prescription.hold.required ? ` ${item.prescription.hold.durationMs / 1000}s` : "—"}
                            </div>
                          </div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>

                      {/* Push Target */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {encourage !== null ? (
                          <div style={{ fontWeight: 700, color: "#3fb950" }}>{encourage}°</div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>

                      {/* Peak ROM */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {maxPeak !== null ? (
                          <div>
                            <div style={{ fontWeight: 700, color: maxPeak >= (romTarget ?? 0) ? "#7cc6ff" : "#ffcc80" }}>{maxPeak}°</div>
                            {romTarget !== null && <div style={{ fontSize: 10, color: maxPeak >= romTarget ? "#3fb950" : "#f85149" }}>{maxPeak >= romTarget ? "↑ target" : `↓ ${romTarget - maxPeak}° short`}</div>}
                          </div>
                        ) : isActive && inferenceLoop.activeMetricValue !== null ? (
                          <div style={{ fontWeight: 700, color: "#a78bfa" }}>{Math.round(inferenceLoop.activeMetricValue)}°</div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>

                      {/* Sets Completed */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {sessionQueue.sessionStarted ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontWeight: 700, color: completionRate >= 0.9 ? "#9be7b0" : completionRate >= 0.6 ? "#ffcc80" : repsCompleted > 0 ? "#ff8f8f" : "#7a88a8" }}>
                              {repsCompleted} / {item.prescription.repTarget}
                            </span>
                            {isPast && completionRate >= 1 && <span style={{ fontSize: 12 }}>✓</span>}
                          </div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>

                      {/* Avg ROM */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {avgPeak !== null ? (
                          <div style={{ fontWeight: 700, color: "#7cc6ff" }}>{avgPeak}°</div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>

                      {/* Avg Hold */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {avgHold !== null ? (
                          <div>
                            <div style={{ fontWeight: 700, color: "white" }}>{avgHold}s</div>
                            {item.prescription.hold.required && (
                              <div style={{ fontSize: 10, color: parseFloat(avgHold) >= item.prescription.hold.durationMs / 1000 * 0.9 ? "#3fb950" : "#f85149" }}>
                                target {item.prescription.hold.durationMs / 1000}s
                              </div>
                            )}
                          </div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>

                      {/* Vision Confidence */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" as const }}>
                        {confVal !== null ? (
                          <div>
                            <div style={{ fontWeight: 700, color: confColor }}>{confVal}%</div>
                            <div style={{ height: 3, width: 48, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 3 }}>
                              <div style={{ height: "100%", width: `${confVal}%`, background: confColor, borderRadius: 2 }} />
                            </div>
                          </div>
                        ) : <span style={{ color: "#484f58" }}>—</span>}
                      </td>
                      {/* Expand toggle */}
                      <td style={{ padding: "0 14px 0 0", textAlign: "right" as const }}>
                        {(peakMetrics.length > 0 || (exerciseRepTimelineRef.current[i]?.length ?? 0) > 0) && (
                          <button
                            onClick={() => setExpandedExerciseRow(expandedExerciseRow === i ? null : i)}
                            style={{ background: "none", border: "none", color: "#7a88a8", cursor: "pointer", fontSize: 11, padding: "4px 6px", borderRadius: 4, fontFamily: "inherit" }}
                          >
                            {expandedExerciseRow === i ? "▲" : "▼"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* Per-rep breakdown row */}
                    {expandedExerciseRow === i && (() => {
                      const repTimeline = exerciseRepTimelineRef.current[i] ?? [];
                      if (repTimeline.length === 0) return null;
                      const romTarget = ((item.prescription as any).romTargetDegrees ?? (item.prescription as any).romAcceptableMin ?? null) as number | null;
                      return (
                        <tr key={`${i}-reps`} style={{ background: "rgba(0,0,0,0.2)" }}>
                          <td colSpan={10} style={{ padding: "0 14px 12px 14px" }}>
                            <div style={{ borderLeft: "2px solid rgba(124,198,255,0.2)", paddingLeft: 16, marginLeft: 8 }}>
                              <div style={{ fontSize: 10, color: "#7a88a8", textTransform: "uppercase" as const, letterSpacing: 0.5, fontWeight: 700, marginBottom: 8, marginTop: 8 }}>
                                Per-Rep Breakdown
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "40px 70px 80px 80px 80px 1fr", gap: "4px 12px", fontSize: 11 }}>
                                {/* Header */}
                                {["Rep", "Outcome", "Peak ROM", "Hold", "vs Target", ""].map(h => (
                                  <div key={h} style={{ color: "#484f58", fontWeight: 700, fontSize: 10, textTransform: "uppercase" as const, letterSpacing: 0.4, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{h}</div>
                                ))}
                                {/* Rows */}
                                {repTimeline.map((rep, ri) => {
                                  const isSuccess = rep.outcome === "success";
                                  const vsTarget = rep.peakRomDeg !== null && romTarget !== null
                                    ? rep.peakRomDeg - romTarget : null;
                                  return (
                                    <React.Fragment key={ri}>
                                      <div style={{ color: "#aab6d3", fontWeight: 600 }}>{rep.rep}</div>
                                      <div style={{ color: isSuccess ? "#3fb950" : "#f85149", fontWeight: 600 }}>
                                        {isSuccess ? "✓ Done" : "✗ Failed"}
                                      </div>
                                      <div style={{ color: isSuccess ? "#7cc6ff" : "#7a88a8" }}>
                                        {rep.peakRomDeg !== null ? `${rep.peakRomDeg}°` : "—"}
                                      </div>
                                      <div style={{ color: rep.holdMs !== null ? "white" : "#484f58" }}>
                                        {rep.holdMs !== null ? `${(rep.holdMs / 1000).toFixed(1)}s` : "—"}
                                      </div>
                                      <div style={{ color: vsTarget === null ? "#484f58" : vsTarget >= 0 ? "#3fb950" : "#f85149" }}>
                                        {vsTarget !== null ? `${vsTarget >= 0 ? "+" : ""}${vsTarget.toFixed(0)}°` : "—"}
                                      </div>
                                      <div style={{ color: "#7a88a8", fontSize: 10 }}>
                                        {!isSuccess && rep.failureReason ? rep.failureReason.replace(/_/g, " ") : ""}
                                      </div>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SESSION SELECTOR (local builder mode only — hidden when prescription loaded) ── */}
      {!prescriptionQueue?.length && (
      <div style={{ background: "#1a2040", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: selectorCollapsed ? 0 : 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 11, color: "#7cc6ff", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Session Selector</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => endSession(true)} disabled={inferenceLoop.engineStatus !== "running"} style={{
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

      {/* ── END SESSION: save and finish later, or finish now ── */}
      {endDialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="endTitle" style={{
          position: "fixed", inset: 0, zIndex: 50, background: "rgba(5,8,18,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div style={{ width: "100%", maxWidth: 520, background: "#141A2E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            <div id="endTitle" style={{ fontSize: 26, fontWeight: 800, color: "white" }}>End your session?</div>
            <div style={{ fontSize: 17, color: "#C9D2EE", lineHeight: 1.4 }}>
              {doneIdx.length} of {fullQueue.length} exercise{fullQueue.length !== 1 ? "s" : ""} finished.
              {doneIdx.length < fullQueue.length ? " You can save and finish the rest later today." : ""}
            </div>
            {doneIdx.length < fullQueue.length && (
              <button onClick={() => endSession(true, { status: "paused", reason: "ended" })} style={{
                background: "#3FB950", color: "#08240F", border: "none", borderRadius: 14, padding: "16px 20px", fontSize: 20, fontWeight: 800, cursor: "pointer", textAlign: "left",
              }}>
                Save and finish later
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>Open your link again today to carry on.</div>
              </button>
            )}
            <button onClick={() => endSession(true, { status: "completed" })} style={{
              background: "rgba(255,255,255,0.06)", color: "#EEF2FF", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: "14px 20px", fontSize: 18, fontWeight: 700, cursor: "pointer", textAlign: "left",
            }}>
              Finish now
              <div style={{ fontSize: 14, fontWeight: 500, color: "#AEB8D6", marginTop: 2 }}>Anything not done is recorded as not done.</div>
            </button>
            <button onClick={() => setEndDialog(false)} style={{
              background: "transparent", color: "#AEB8D6", border: "none", padding: 8, fontSize: 16, cursor: "pointer",
            }}>
              Keep going
            </button>
          </div>
        </div>
      )}

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
        @keyframes wave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          50% { transform: scaleY(1); opacity: 1; }
        }
        @keyframes ledBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
        @keyframes ledGlow { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
