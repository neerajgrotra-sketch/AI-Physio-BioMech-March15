// ============================================================
// lib/debug/movementTimeline.ts
// ============================================================
// Types and store for the movement timeline debug panel.
//
// The timeline merges two streams:
// 1. Movement snapshots — sampled every 500ms from the
//    inference loop (phase, metric value, rep count, hold)
// 2. Events — phase transitions, rep outcomes, messages
//
// Events are embedded inline at their exact timestamp so
// you can see what the body was doing when each message fired.
// ============================================================

// ============================================================
// TIMELINE ENTRY TYPES
// ============================================================

export type MovementSnapshot = {
  kind: "snapshot";
  timestampMs: number;
  timestamp: string;
  phase: string;
  repCount: number;
  repTarget: number;
  activeMetricValue: number | null;
  holdElapsedMs: number | null;
  holdRequiredMs: number | null;
  primaryIssue: string;
};

export type TimelineEvent =
  | {
      kind: "phase_change";
      timestampMs: number;
      timestamp: string;
      fromPhase: string;
      toPhase: string;
    }
  | {
      kind: "rep_completed";
      timestampMs: number;
      timestamp: string;
      repNumber: number;
    }
  | {
      kind: "rep_failed";
      timestampMs: number;
      timestamp: string;
      reason: string;
      repNumber: number;
    }
  | {
      kind: "hold_started";
      timestampMs: number;
      timestamp: string;
      holdRequiredMs: number;
    }
  | {
      kind: "message";
      timestampMs: number;
      timestamp: string;
      source: "ai" | "fallback" | "deterministic";
      trigger: string;
      text: string;
      tone: string;
      latencyMs: number | null; // ms from trigger to message appearing
    }
  | {
      kind: "exercise_start";
      timestampMs: number;
      timestamp: string;
      exerciseName: string;
    }
  | {
      kind: "exercise_complete";
      timestampMs: number;
      timestamp: string;
      exerciseName: string;
      successfulReps: number;
      failedReps: number;
    };

export type TimelineEntry = MovementSnapshot | TimelineEvent;

// ============================================================
// TIMELINE STORE
// ============================================================
// Module-level store so inference loop can write without
// React closure issues — same pattern as the debug log.
// ============================================================

const MAX_ENTRIES = 500; // Keep last 500 entries

let timelineEntries: TimelineEntry[] = [];
let setTimelineEntriesGlobal:
  | React.Dispatch<React.SetStateAction<TimelineEntry[]>>
  | null = null;

let lastSnapshotMs = 0;
const SNAPSHOT_INTERVAL_MS = 500; // Sample every 500ms

let lastPhase = "ready";
let lastTriggerMs: Record<string, number> = {};

export function registerTimelineStateSetter(
  setter: React.Dispatch<React.SetStateAction<TimelineEntry[]>>
) {
  setTimelineEntriesGlobal = setter;
}

export function unregisterTimelineStateSetter() {
  setTimelineEntriesGlobal = null;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 2
  });
}

function push(entry: TimelineEntry) {
  timelineEntries = [entry, ...timelineEntries].slice(0, MAX_ENTRIES);
  if (setTimelineEntriesGlobal) {
    setTimelineEntriesGlobal([...timelineEntries]);
  }
}

// ============================================================
// PUBLIC API
// ============================================================

export function resetTimeline() {
  timelineEntries = [];
  lastSnapshotMs = 0;
  lastPhase = "ready";
  lastTriggerMs = {};
  if (setTimelineEntriesGlobal) {
    setTimelineEntriesGlobal([]);
  }
}

export function recordSnapshot(params: {
  nowMs: number;
  phase: string;
  repCount: number;
  repTarget: number;
  activeMetricValue: number | null;
  holdElapsedMs: number | null;
  holdRequiredMs: number | null;
  primaryIssue: string;
}) {
  const { nowMs, phase } = params;

  // Detect phase change
  if (phase !== lastPhase) {
    push({
      kind: "phase_change",
      timestampMs: nowMs,
      timestamp: formatTimestamp(nowMs),
      fromPhase: lastPhase,
      toPhase: phase
    });
    lastPhase = phase;
  }

  // Sample snapshot at interval
  if (nowMs - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotMs = nowMs;
    push({
      kind: "snapshot",
      timestampMs: nowMs,
      timestamp: formatTimestamp(nowMs),
      ...params
    });
  }
}

export function recordRepCompleted(repNumber: number, nowMs: number) {
  lastTriggerMs["rep_completed"] = nowMs;
  push({
    kind: "rep_completed",
    timestampMs: nowMs,
    timestamp: formatTimestamp(nowMs),
    repNumber
  });
}

export function recordRepFailed(
  reason: string,
  repNumber: number,
  nowMs: number
) {
  lastTriggerMs["rep_failed"] = nowMs;
  push({
    kind: "rep_failed",
    timestampMs: nowMs,
    timestamp: formatTimestamp(nowMs),
    reason,
    repNumber
  });
}

export function recordHoldStarted(holdRequiredMs: number, nowMs: number) {
  lastTriggerMs["hold_started"] = nowMs;
  push({
    kind: "hold_started",
    timestampMs: nowMs,
    timestamp: formatTimestamp(nowMs),
    holdRequiredMs
  });
}

export function recordMessage(params: {
  source: "ai" | "fallback" | "deterministic";
  trigger: string;
  text: string;
  tone: string;
  nowMs: number;
}) {
  const { source, trigger, text, tone, nowMs } = params;

  // Calculate latency from the trigger that caused this message
  const triggerMs = lastTriggerMs[trigger] ?? null;
  const latencyMs = triggerMs !== null ? nowMs - triggerMs : null;

  push({
    kind: "message",
    timestampMs: nowMs,
    timestamp: formatTimestamp(nowMs),
    source,
    trigger,
    text,
    tone,
    latencyMs
  });
}

export function recordExerciseStart(exerciseName: string, nowMs: number) {
  resetTimeline();
  push({
    kind: "exercise_start",
    timestampMs: nowMs,
    timestamp: formatTimestamp(nowMs),
    exerciseName
  });
}

export function recordExerciseComplete(params: {
  exerciseName: string;
  successfulReps: number;
  failedReps: number;
  nowMs: number;
}) {
  push({
    kind: "exercise_complete",
    timestampMs: params.nowMs,
    timestamp: formatTimestamp(params.nowMs),
    exerciseName: params.exerciseName,
    successfulReps: params.successfulReps,
    failedReps: params.failedReps
  });
}

// ============================================================
// TIMELINE TO TEXT
// For copy functionality
// ============================================================

export function timelineToText(entries: TimelineEntry[]): string {
  const lines: string[] = ["=== MOVEMENT TIMELINE ===", ""];

  // Entries are newest-first, reverse for chronological display
  const chronological = [...entries].reverse();

  for (const entry of chronological) {
    switch (entry.kind) {
      case "exercise_start":
        lines.push(
          "─".repeat(50),
          entry.timestamp + "  ▶ EXERCISE START: " + entry.exerciseName,
          "─".repeat(50)
        );
        break;

      case "exercise_complete":
        lines.push(
          entry.timestamp +
            "  ✓ EXERCISE COMPLETE: " +
            entry.exerciseName +
            " (" +
            entry.successfulReps +
            " good, " +
            entry.failedReps +
            " failed)"
        );
        break;

      case "phase_change":
        lines.push(
          entry.timestamp +
            "  → " +
            entry.fromPhase.toUpperCase() +
            " → " +
            entry.toPhase.toUpperCase()
        );
        break;

      case "snapshot":
        const metric =
          entry.activeMetricValue !== null
            ? " | metric=" + entry.activeMetricValue.toFixed(1) + "°"
            : "";
        const hold =
          entry.holdElapsedMs !== null
            ? " | hold=" + Math.round(entry.holdElapsedMs) + "ms"
            : "";
        lines.push(
          entry.timestamp +
            "  [" +
            entry.phase.toUpperCase().padEnd(8) +
            "]" +
            "  rep=" +
            entry.repCount +
            "/" +
            entry.repTarget +
            metric +
            hold
        );
        break;

      case "rep_completed":
        lines.push(
          entry.timestamp + "  ✓ REP " + entry.repNumber + " COMPLETED"
        );
        break;

      case "rep_failed":
        lines.push(
          entry.timestamp +
            "  ✗ REP " +
            entry.repNumber +
            " FAILED: " +
            entry.reason
        );
        break;

      case "hold_started":
        lines.push(
          entry.timestamp +
            "  ⏱ HOLD STARTED (" +
            entry.holdRequiredMs / 1000 +
            "s required)"
        );
        break;

      case "message":
        const sourceLabel =
          entry.source === "ai"
            ? "AI"
            : entry.source === "fallback"
            ? "FALLBACK"
            : "DETERMINISTIC";
        const latency =
          entry.latencyMs !== null
            ? " [+" + entry.latencyMs + "ms]"
            : "";
        lines.push(
          entry.timestamp +
            "  💬 [" +
            sourceLabel +
            "] [" +
            entry.trigger +
            "]" +
            latency +
            ': "' +
            entry.text +
            '"'
        );
        break;
    }
  }

  return lines.join("\n");
}
