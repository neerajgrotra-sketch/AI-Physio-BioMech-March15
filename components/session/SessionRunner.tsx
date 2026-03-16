"use client";

import React, { useEffect, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import CameraViewport from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import CoachingPanel from "@/components/coaching/CoachingPanel";
import DebugPanel from "@/components/debug/DebugPanel";

import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { buildCoachingDecision } from "@/lib/coaching/coachingPolicy";
import { EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import {
  createInitialRepState,
  type RepState
} from "@/lib/interpreter/repStateMachine";
import { interpretMovement } from "@/lib/interpreter/movementInterpreter";
import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { CoachingDecision } from "@/lib/types/coaching";

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
    leftWristToShoulderDy: null
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
  const exercise = EXERCISE_LIBRARY[0];

  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const repStateRef = useRef<RepState>(createInitialRepState());

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [repCount, setRepCount] = useState<number>(0);
  const [phase, setPhase] = useState<string>("ready");
  const [activeElevation, setActiveElevation] = useState<number | null>(null);
  const [coaching, setCoaching] = useState<CoachingDecision>(createIdleCoaching());
  const [engineStatus, setEngineStatus] = useState<
    "idle" | "loading" | "running" | "error"
  >("idle");
  const [engineError, setEngineError] = useState<string>("");

  async function beginTracking(video: HTMLVideoElement) {
    try {
      setEngineStatus("loading");
      setEngineError("");
      videoRef.current = video;

      if (!detectorRef.current) {
        detectorRef.current = await createPoseDetector();
      }

      setEngineStatus("running");

      const loop = async () => {
        if (!videoRef.current || !detectorRef.current) return;

        try {
          const poses = await detectorRef.current.estimatePoses(videoRef.current);
          const pose = poses[0] ?? null;

          const normalized = normalizePoseFrame(
            pose,
            videoRef.current.videoWidth || 1,
            videoRef.current.videoHeight || 1
          );

          setFrame(normalized);

          const nextFeatures = normalized.personDetected
            ? extractMovementFeatures(normalized)
            : createEmptyFeatures();

          setFeatures(nextFeatures);

          const output = interpretMovement(
            repStateRef.current,
            nextFeatures,
            exercise,
            normalized.personDetected
          );

          repStateRef.current = output.repState;

          setRepCount(output.repState.repCount);
          setPhase(output.repState.phase);
          setActiveElevation(output.activeElevationDeg);
          setCoaching(buildCoachingDecision(output));
        } catch (error) {
          setEngineStatus("error");
          setEngineError(
            error instanceof Error ? error.message : "Pose estimation failed."
          );
          return;
        }

        rafRef.current = window.requestAnimationFrame(loop);
      };

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(loop);
    } catch (error) {
      setEngineStatus("error");
      setEngineError(
        error instanceof Error ? error.message : "Could not initialize pose detector."
      );
    }
  }

  function resetExercise() {
    repStateRef.current = createInitialRepState();
    setRepCount(0);
    setPhase("ready");
    setActiveElevation(null);
    setCoaching(createIdleCoaching());
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

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
            Start the camera and perform the current exercise.
          </p>

          <CameraViewport onVideoReady={beginTracking} />

          <div
            style={{
              marginTop: 16,
              position: "relative",
              width: "100%",
              maxWidth: 640,
              height: 420,
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.10)"
            }}
          >
            <PoseCanvasOverlay frame={frame} width={640} height={420} />
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

            <div style={{ display: "grid", gap: 8, marginTop: 12, fontSize: 14 }}>
              <div>
                Engine status: <strong>{engineStatus}</strong>
              </div>
              <div>
                Phase: <strong>{phase}</strong>
              </div>
              <div>
                Reps: <strong>{repCount} / {exercise.repTarget}</strong>
              </div>
              <div>
                Active elevation: <strong>{activeElevation ?? "—"}</strong>
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

          <CoachingPanel title="Coaching" message={coaching.message} />

          <DebugPanel features={features} />
        </div>
      </div>
    </div>
  );
}
