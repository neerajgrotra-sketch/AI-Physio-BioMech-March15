"use client";

import React, { useEffect, useRef, useState } from "react";

type Props = {
  onVideoReady?: (video: HTMLVideoElement) => void;
};

export default function CameraViewport({ onVideoReady }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function startCamera() {
    try {
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

      if (!videoRef.current) {
        throw new Error("Video element not available.");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      setStatus("live");

      if (onVideoReady) {
        onVideoReady(videoRef.current);
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Could not start camera."
      );
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setStatus("idle");
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

      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: "100%",
          maxHeight: 420,
          borderRadius: 12,
          background: "#0b1020",
          objectFit: "cover"
        }}
      />
    </div>
  );
}
