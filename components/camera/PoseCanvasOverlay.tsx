"use client";

import React, { useEffect, useRef } from "react";
import type { PoseFrame } from "@/lib/types/pose";

type Props = {
  frame: PoseFrame | null;
};

export default function PoseCanvasOverlay({ frame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = 640;
    const height = 420;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#7cc6ff";
    ctx.fillStyle = "#7cc6ff";
    ctx.lineWidth = 2;

    if (!frame?.personDetected) return;

    for (const landmark of Object.values(frame.landmarks)) {
      if (!landmark) continue;

      const x = landmark.x * width;
      const y = landmark.y * height;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [frame]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        maxHeight: 420,
        borderRadius: 12,
        background: "rgba(255,255,255,0.03)"
      }}
    />
  );
}
