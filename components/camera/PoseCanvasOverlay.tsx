"use client";

import React, { useEffect, useRef } from "react";
import type { PoseFrame } from "@/lib/types/pose";

type Props = {
  frame: PoseFrame | null;
  width?: number;
  height?: number;
};

export default function PoseCanvasOverlay({
  frame,
  width = 640,
  height = 420
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!frame?.personDetected) return;

    ctx.strokeStyle = "#7cc6ff";
    ctx.fillStyle = "#7cc6ff";
    ctx.lineWidth = 2;

    for (const landmark of Object.values(frame.landmarks)) {
      if (!landmark) continue;

      const x = landmark.x * width;
      const y = landmark.y * height;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [frame, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        borderRadius: 12
      }}
    />
  );
}
