// ============================================================
// components/debug/MovementTimelinePanel.tsx
// ============================================================
// Visual movement timeline with superimposed coaching messages.
//
// Shows a chronological stream of:
// - Movement snapshots (phase, metric, rep, hold) every 500ms
// - Phase transition markers
// - Rep completed / failed events
// - Coaching messages embedded at their exact timestamp
//   with latency from trigger to display
// ============================================================

"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  registerTimelineStateSetter,
  unregisterTimelineStateSetter,
  timelineToText,
  type TimelineEntry,
  type MovementSnapshot,
  type TimelineEvent
} from "@/lib/debug/movementTimeline";

// ============================================================
// PHASE COLOURS
// ============================================================

const PHASE_COLORS: Record<string, { bg: string; color: string }> = {
  lifting:  { bg: "rgba(124,198,255,0.15)", color: "#7cc6ff" },
  holding:  { bg: "rgba(100,220,150,0.15)", color: "#9be7b0" },
  lowering: { bg: "rgba(180,130,255,0.15)", color: "#c4a0ff" },
  ready:    { bg: "rgba(255,255,255,0.06)", color: "#aab6d3" },
  complete: { bg: "rgba(100,220,150,0.2)",  color: "#9be7b0" },
  top:      { bg: "rgba(100,220,150,0.12)", color: "#9be7b0" },
  unknown:  { bg: "rgba(255,255,255,0.04)", color: "#7a88a8" }
};

function getPhaseStyle(phase: string) {
  return PHASE_COLORS[phase] ?? PHASE_COLORS.unknown;
}

// ============================================================
// SOURCE BADGE
// ============================================================

function SourceBadge({ source }: { source: "ai" | "fallback" | "deterministic" }) {
  const styles = {
    ai:            { bg: "rgba(100,220,200,0.2)",  color: "#6ee7d4",  label: "AI",            icon: "🟢" },
    fallback:      { bg: "rgba(255,200,80,0.2)",   color: "#ffcc80",  label: "FALLBACK",      icon: "🟡" },
    deterministic: { bg: "rgba(124,198,255,0.15)", color: "#7cc6ff",  label: "DETERMINISTIC", icon: "🔵" }
  };
  const s = styles[source];
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700,
      padding: "2px 7px", borderRadius: 4,
      letterSpacing: 0.5
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ============================================================
// ENTRY RENDERERS
// ============================================================

function SnapshotRow({ entry }: { entry: MovementSnapshot }) {
  const ps = getPhaseStyle(entry.phase);
  const hasHold = entry.holdElapsedMs !== null && entry.holdRequiredMs !== null;
  const holdPct = hasHold
    ? Math.min(100, Math.round((entry.holdElapsedMs! / entry.holdRequiredMs!) * 100))
    : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "3px 8px", borderRadius: 6,
      background: "rgba(255,255,255,0.02)"
    }}>
      {/* Timestamp */}
      <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", flexShrink: 0, width: 90 }}>
        {entry.timestamp}
      </span>

      {/* Phase badge */}
      <span style={{
        fontSize: 10, fontWeight: 700,
        padding: "2px 7px", borderRadius: 4,
        background: ps.bg, color: ps.color,
        width: 64, textAlign: "center", flexShrink: 0
      }}>
        {entry.phase.toUpperCase().slice(0, 7)}
      </span>

      {/* Rep count */}
      <span style={{ fontSize: 11, color: "#aab6d3", flexShrink: 0 }}>
        {entry.repCount}/{entry.repTarget}
      </span>

      {/* Metric value */}
      {entry.activeMetricValue !== null && (
        <span style={{ fontSize: 11, color: "#7cc6ff", fontFamily: "monospace", flexShrink: 0 }}>
          {entry.activeMetricValue.toFixed(1)}°
        </span>
      )}

      {/* Hold progress */}
      {hasHold && holdPct !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <div style={{
            width: 40, height: 4, borderRadius: 2,
            background: "rgba(255,255,255,0.1)", overflow: "hidden"
          }}>
            <div style={{
              width: holdPct + "%", height: "100%",
              background: holdPct >= 100 ? "#9be7b0" : "#7cc6ff",
              borderRadius: 2
            }} />
          </div>
          <span style={{ fontSize: 10, color: "#7a88a8" }}>
            {Math.round(entry.holdElapsedMs! / 100) / 10}s
          </span>
        </div>
      )}

      {/* Primary issue */}
      {entry.primaryIssue && entry.primaryIssue !== "idle" && (
        <span style={{ fontSize: 10, color: "#ffcc80", marginLeft: "auto" }}>
          {entry.primaryIssue.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

function EventRow({ entry }: { entry: TimelineEvent }) {
  switch (entry.kind) {
    case "exercise_start":
      return (
        <div style={{
          padding: "6px 8px", margin: "4px 0",
          background: "rgba(124,198,255,0.08)",
          border: "1px solid rgba(124,198,255,0.2)",
          borderRadius: 6
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", marginRight: 8 }}>
            {entry.timestamp}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#7cc6ff" }}>
            ▶ {entry.exerciseName}
          </span>
        </div>
      );

    case "exercise_complete":
      return (
        <div style={{
          padding: "6px 8px", margin: "4px 0",
          background: "rgba(100,220,150,0.08)",
          border: "1px solid rgba(100,220,150,0.2)",
          borderRadius: 6
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", marginRight: 8 }}>
            {entry.timestamp}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#9be7b0" }}>
            ✓ Complete — {entry.successfulReps} good, {entry.failedReps} failed
          </span>
        </div>
      );

    case "phase_change":
      return (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "2px 8px"
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", width: 90, flexShrink: 0 }}>
            {entry.timestamp}
          </span>
          <span style={{ fontSize: 10, color: "#7a88a8" }}>→</span>
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: getPhaseStyle(entry.toPhase).color
          }}>
            {entry.toPhase.toUpperCase()}
          </span>
        </div>
      );

    case "rep_completed":
      return (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "3px 8px", marginLeft: 16,
          borderLeft: "2px solid #9be7b0"
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", width: 90, flexShrink: 0 }}>
            {entry.timestamp}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#9be7b0" }}>
            ✓ Rep {entry.repNumber + 1} completed
          </span>
        </div>
      );

    case "rep_failed":
      return (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "3px 8px", marginLeft: 16,
          borderLeft: "2px solid #ff8f8f"
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", width: 90, flexShrink: 0 }}>
            {entry.timestamp}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#ff8f8f" }}>
            ✗ Rep {entry.repNumber + 1} failed: {entry.reason.replace(/_/g, " ")}
          </span>
        </div>
      );

    case "hold_started":
      return (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "2px 8px", marginLeft: 16,
          borderLeft: "2px solid #7cc6ff"
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", width: 90, flexShrink: 0 }}>
            {entry.timestamp}
          </span>
          <span style={{ fontSize: 10, color: "#7cc6ff" }}>
            ⏱ hold started ({entry.holdRequiredMs / 1000}s required)
          </span>
        </div>
      );

    case "message":
      const latencyLabel = entry.latencyMs !== null
        ? "+" + entry.latencyMs + "ms"
        : "";
      const triggerLabel = entry.trigger.replace(/_/g, " ");
      return (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "5px 8px 5px 20px", marginLeft: 8,
          borderLeft: "3px solid " + (
            entry.source === "ai" ? "#6ee7d4" :
            entry.source === "fallback" ? "#ffcc80" : "#7cc6ff"
          ),
          background: entry.source === "ai"
            ? "rgba(100,220,200,0.05)"
            : entry.source === "fallback"
            ? "rgba(255,200,80,0.05)"
            : "rgba(124,198,255,0.05)",
          borderRadius: "0 6px 6px 0"
        }}>
          <span style={{ fontSize: 10, color: "#7a88a8", fontFamily: "monospace", width: 90, flexShrink: 0, paddingTop: 2 }}>
            {entry.timestamp}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
              <SourceBadge source={entry.source} />
              <span style={{ fontSize: 10, color: "#7a88a8" }}>{triggerLabel}</span>
              {latencyLabel && (
                <span style={{
                  fontSize: 10, color: "#7a88a8",
                  background: "rgba(255,255,255,0.06)",
                  padding: "1px 5px", borderRadius: 3
                }}>
                  {latencyLabel}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 13, color: "white", fontWeight: 500,
              lineHeight: 1.4,
              fontStyle: "italic"
            }}>
              "{entry.text}"
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

// ============================================================
// MOVEMENT TIMELINE PANEL
// ============================================================

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  });
}

type MovementTimelinePanelProps = {
  defaultOpen?: boolean;
};

export default function MovementTimelinePanel({
  defaultOpen = false
}: MovementTimelinePanelProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Register with global store
  useEffect(() => {
    registerTimelineStateSetter(setEntries);
    return () => unregisterTimelineStateSetter();
  }, []);

  // Auto-scroll to top (newest entry) when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length, autoScroll, isOpen]);

  function handleCopy() {
    copyToClipboard(timelineToText(entries));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Filter entries based on showSnapshots toggle
  const filteredEntries = showSnapshots
    ? entries
    : entries.filter(e => e.kind !== "snapshot");

  const messageCount = entries.filter(e => e.kind === "message").length;
  const repCount = entries.filter(e => e.kind === "rep_completed").length;
  const failCount = entries.filter(e => e.kind === "rep_failed").length;

  return (
    <div style={{
      background: "#080d1a",
      borderRadius: 12,
      border: "1px solid rgba(124,198,255,0.15)",
      overflow: "hidden",
      marginTop: 12
    }}>
      {/* Header */}
      <div
        onClick={() => setIsOpen(v => !v)}
        style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "10px 16px",
          background: "rgba(124,198,255,0.04)",
          borderBottom: isOpen ? "1px solid rgba(124,198,255,0.1)" : "none",
          cursor: "pointer", userSelect: "none"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: "#7cc6ff",
            textTransform: "uppercase", letterSpacing: 0.8
          }}>
            Movement Timeline
          </span>
          {/* Live stats */}
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{
              fontSize: 10, padding: "1px 7px", borderRadius: 3,
              background: "rgba(100,220,200,0.12)", color: "#6ee7d4"
            }}>
              {messageCount} msgs
            </span>
            <span style={{
              fontSize: 10, padding: "1px 7px", borderRadius: 3,
              background: "rgba(100,220,150,0.12)", color: "#9be7b0"
            }}>
              {repCount} ✓
            </span>
            {failCount > 0 && (
              <span style={{
                fontSize: 10, padding: "1px 7px", borderRadius: 3,
                background: "rgba(255,100,100,0.12)", color: "#ff8f8f"
              }}>
                {failCount} ✗
              </span>
            )}
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 8, alignItems: "center" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Snapshots toggle */}
          <button
            onClick={() => setShowSnapshots(v => !v)}
            style={{
              background: showSnapshots ? "rgba(124,198,255,0.15)" : "rgba(255,255,255,0.05)",
              color: showSnapshots ? "#7cc6ff" : "#7a88a8",
              border: "none", borderRadius: 6,
              padding: "3px 10px", fontSize: 11, cursor: "pointer"
            }}
          >
            {showSnapshots ? "Hide snapshots" : "Show snapshots"}
          </button>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(v => !v)}
            style={{
              background: autoScroll ? "rgba(100,220,150,0.12)" : "rgba(255,255,255,0.05)",
              color: autoScroll ? "#9be7b0" : "#7a88a8",
              border: "none", borderRadius: 6,
              padding: "3px 10px", fontSize: 11, cursor: "pointer"
            }}
          >
            {autoScroll ? "Auto ↑" : "Manual"}
          </button>

          {/* Copy */}
          <button
            onClick={handleCopy}
            style={{
              background: copied ? "rgba(100,220,150,0.2)" : "rgba(100,220,200,0.12)",
              color: copied ? "#9be7b0" : "#6ee7d4",
              border: "1px solid " + (copied ? "rgba(100,220,150,0.3)" : "rgba(100,220,200,0.2)"),
              borderRadius: 6, padding: "3px 12px",
              fontSize: 11, fontWeight: 700, cursor: "pointer"
            }}
          >
            {copied ? "Copied ✓" : "📋 Copy Timeline"}
          </button>

          {/* Clear */}
          <button
            onClick={() => {
              setEntries([]);
              const { resetTimeline } = require("@/lib/debug/movementTimeline");
              resetTimeline();
            }}
            style={{
              background: "rgba(255,255,255,0.05)", color: "#7a88a8",
              border: "none", borderRadius: 6,
              padding: "3px 10px", fontSize: 11, cursor: "pointer"
            }}
          >
            Clear
          </button>

          <span style={{ color: "#7a88a8", fontSize: 12 }}>
            {isOpen ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Timeline */}
      {isOpen && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 500, overflowY: "auto",
            padding: "8px 12px",
            display: "flex", flexDirection: "column", gap: 2
          }}
        >
          {filteredEntries.length === 0 ? (
            <div style={{ color: "#7a88a8", fontSize: 12, padding: "12px 4px" }}>
              Timeline starts when you begin a session.
              Movement snapshots appear every 500ms.
              Coaching messages are superimposed inline.
            </div>
          ) : (
            filteredEntries.map((entry, index) => {
              const key = entry.timestampMs + "-" + entry.kind + "-" + index;
              if (entry.kind === "snapshot") {
                return <SnapshotRow key={key} entry={entry} />;
              }
              return <EventRow key={key} entry={entry as TimelineEvent} />;
            })
          )}
        </div>
      )}
    </div>
  );
}
