"use client";

import React, { useEffect, useRef, useState } from "react";

type Props = {
  onVideoReady?: (video: HTMLVideoElement) => void;
  onCameraStop?: () => void;
};

export default function CameraViewport({ onVideoReady, onCameraStop }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function startCamera() {
    try {
      if (status === "starting" || status === "live") return;

      setStatus("starting");
      setErrorMessage("");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element not available.");
      }

      video.srcObject = stream;
      await video.play();

      setStatus("live");
      onVideoReady?.(video);
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Could not start camera."
      );
    }
  }

  function stopCamera() {
    const video = videoRef.current;

    if (video) {
      try {
        video.pause();
      } catch {}

      video.srcObject = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }

    setStatus("idle");
    setErrorMessage("");
    onCameraStop?.();
  }

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          onClick={startCamera}
          disabled={status === "starting" || status === "live"}
          style={{
            background: "#7cc6ff",
            color: "#08111f",
            fontWeight: 700
          }}
        >
          {status === "starting" ? "Starting..." : "Start Camera"}
        </button>

        <button
          onClick={stopCamera}
          disabled={status !== "live"}
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "white"
          }}
        >
          Stop Camera
        </button>
      </div>

      {status === "error" && (
        <p style={{ color: "#ff8f8f", marginTop: 0 }}>{errorMessage}</p>
      )}

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 640,
          height: 420,
          borderRadius: 12,
          overflow: "hidden",
          background: "#0b1020",
          border: "1px solid rgba(255,255,255,0.10)"
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            transform: "scaleX(-1)"
          }}
        />
      </div>
    </div>
  );
}
