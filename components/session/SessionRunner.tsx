"use client";

import React, { useEffect, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";
import CameraViewport from "@/components/camera/CameraViewport";
import CoachingPanel from "@/components/coaching/CoachingPanel";
import DebugPanel from "@/components/debug/DebugPanel";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { EXERCISE_LIBRARY } from "@/lib/exercises/exerciseLibrary";
import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";
import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";

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

export default function SessionRunner() {
  const exercise = EXERCISE_LIBRARY[0];

  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [engineStatus, setEngineStatus] = useState<
    "idle" | "loading" | "running" | "error"
  >("idle");
  const [engineError, setEngineError] = useState("");

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

          if (normalized.personDetected) {
            setFeatures(extractMovementFeatures(normalized));
          } else {
            setFeatures(createEmptyFeatures());
          }
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
            Start the camera to feed live landmarks into the biomechanics engine.
          </p>

          <CameraViewport onVideoReady={beginTracking} />

          <div style={{ marginTop: 16 }}>
            <PoseCanvasOverlay frame={frame} />
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

            <div style={{ marginTop: 12, fontSize: 14, color: "#aab6d3" }}>
              Engine status: <strong style={{ color: "white" }}>{engineStatus}</strong>
            </div>

            {engineError && (
              <p style={{ color: "#ff8f8f", marginBottom: 0 }}>{engineError}</p>
            )}
          </section>

          <CoachingPanel
            title="Coaching"
            message={
              frame?.personDetected
                ? "Pose detected. We are now computing real movement features from live landmarks."
                : "Start the camera and step into frame."
            }
          />

          <DebugPanel features={features} />
        </div>
      </div>
    </div>
  );
}
