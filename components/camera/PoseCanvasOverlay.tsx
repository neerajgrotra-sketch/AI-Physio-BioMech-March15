"use client";

import { useEffect, useRef } from "react";

import type { PoseFrame } from "@/lib/types/pose";

type Props = {
  frame: PoseFrame | null;
  width?: number;
  height?: number;
  className?: string;
};

type OverlayKeypoint = {
  name: string;
  x: number;
  y: number;
  score?: number | null;
};

const CONNECTIONS: Array<[string, string]> = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"]
];

function getFrameKeypoints(frame: PoseFrame | null): OverlayKeypoint[] {
  if (!frame || typeof frame !== "object") return [];

  const maybeKeypoints = (frame as any).keypoints;
  if (!Array.isArray(maybeKeypoints)) return [];

  return maybeKeypoints.filter((kp: any) => {
    return (
      kp &&
      typeof kp.name === "string" &&
      typeof kp.x === "number" &&
      typeof kp.y === "number"
    );
  }) as OverlayKeypoint[];
}

function getKeypoint(frame: PoseFrame | null, name: string): OverlayKeypoint | null {
  const keypoints = getFrameKeypoints(frame);
  return keypoints.find((kp) => kp.name === name) ?? null;
}

function isVisible(keypoint: OverlayKeypoint | null, minScore = 0.25): keypoint is OverlayKeypoint {
  if (!keypoint) return false;
  return (keypoint.score ?? 1) >= minScore;
}

export default function PoseCanvasOverlay({
  frame,
  width = 640,
  height = 420,
  className
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const renderWidth = parent?.clientWidth ?? width;
    const renderHeight = parent?.clientHeight ?? height;

    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    canvas.width = Math.max(1, Math.floor(renderWidth * dpr));
    canvas.height = Math.max(1, Math.floor(renderHeight * dpr));
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${renderHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, renderWidth, renderHeight);

    const personDetected = Boolean((frame as any)?.personDetected);
    const keypoints = getFrameKeypoints(frame);

    if (!personDetected || keypoints.length === 0) {
      return;
    }

    ctx.save();
    ctx.translate(renderWidth, 0);
    ctx.scale(-1, 1);

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(124, 198, 255, 0.95)";
    ctx.fillStyle = "rgba(155, 231, 176, 0.95)";

    for (const [aName, bName] of CONNECTIONS) {
      const a = getKeypoint(frame, aName);
      const b = getKeypoint(frame, bName);

      if (!isVisible(a) || !isVisible(b)) continue;

      ctx.beginPath();
      ctx.moveTo(a.x * renderWidth, a.y * renderHeight);
      ctx.lineTo(b.x * renderWidth, b.y * renderHeight);
      ctx.stroke();
    }

    for (const keypoint of keypoints) {
      if (!isVisible(keypoint)) continue;

      const x = keypoint.x * renderWidth;
      const y = keypoint.y * renderHeight;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [frame, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none"
      }}
    />
  );
}