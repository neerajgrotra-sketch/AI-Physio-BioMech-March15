"use client";

import CoachingPanel from "@/components/coaching/CoachingPanel";
import DebugPanel from "@/components/debug/DebugPanel";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import type { PoseFrame } from "@/lib/types/pose";

function createMockPoseFrame(): PoseFrame {
  return {
    timestamp: Date.now(),
    personDetected: true,
    landmarks: {
      nose: { x: 0.5, y: 0.16 },

      left_shoulder: { x: 0.42, y: 0.34 },
      right_shoulder: { x: 0.58, y: 0.34 },

      left_elbow: { x: 0.39, y: 0.27 },
      right_elbow: { x: 0.62, y: 0.24 },

      left_wrist: { x: 0.37, y: 0.19 },
      right_wrist: { x: 0.66, y: 0.14 },

      left_hip: { x: 0.45, y: 0.58 },
      right_hip: { x: 0.55, y: 0.58 },

      left_knee: { x: 0.46, y: 0.78 },
      right_knee: { x: 0.54, y: 0.78 }
    }
  };
}

export default function SessionRunner() {
  const exercise = EXERCISE_LIBRARY[0];
  const mockFrame = createMockPoseFrame();
  const features = extractMovementFeatures(mockFrame);

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
            Webcam and pose overlay will be mounted here in the next step.
          </p>

          <div
            style={{
              marginTop: 16,
              height: 280,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#7cc6ff",
              background: "rgba(255,255,255,0.03)"
            }}
          >
            Camera placeholder
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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

            <h3 style={{ marginTop: 0 }}>{exercise.name}</h3>
            <p style={{ color: "#aab6d3" }}>{exercise.description}</p>

            <button
              style={{
                marginTop: 10,
                background: "#7cc6ff",
                color: "#08111f",
                fontWeight: 700
              }}
            >
              Start Session
            </button>
          </section>

          <CoachingPanel
            title="Coaching"
            message="Great. This is the new architecture shell. Next we connect live pose detection, then interpret right arm raise performance from real landmarks."
          />

          <DebugPanel features={features} />
        </div>
      </div>
    </div>
  );
}
