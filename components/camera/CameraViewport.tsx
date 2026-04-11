"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";

export type CameraViewportHandle = {
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  getVideoElement: () => HTMLVideoElement | null;
};

type CameraViewportProps = {
  onVideoReady?: (video: HTMLVideoElement) => void | Promise<void>;
  onCameraStop?: () => void;
  showStartButton?: boolean;
  className?: string;
};

const CameraViewport = forwardRef<CameraViewportHandle, CameraViewportProps>(
  function CameraViewport(
    {
      onVideoReady,
      onCameraStop,
      showStartButton = true,
      className
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const startingRef = useRef(false);

    const onVideoReadyRef = useRef(onVideoReady);
    const onCameraStopRef = useRef(onCameraStop);

    useEffect(() => {
      onVideoReadyRef.current = onVideoReady;
    }, [onVideoReady]);

    useEffect(() => {
      onCameraStopRef.current = onCameraStop;
    }, [onCameraStop]);

    const [cameraState, setCameraState] = useState<
      "idle" | "starting" | "running" | "error"
    >("idle");
    const [errorMessage, setErrorMessage] = useState("");

    const stopCamera = useCallback(() => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          try {
            track.stop();
          } catch {}
        }
        streamRef.current = null;
      }

      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
        } catch {}
        video.srcObject = null;
      }

      startingRef.current = false;
      setCameraState("idle");
      setErrorMessage("");
      onCameraStopRef.current?.();
    }, []);

    const startCamera = useCallback(async () => {
      if (startingRef.current || cameraState === "running") return;

      startingRef.current = true;
      setCameraState("starting");
      setErrorMessage("");

      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error("Camera access is not supported in this browser.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        const video = videoRef.current;
        if (!video) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          throw new Error("Video element is not available.");
        }

        streamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;

        await video.play();

        setCameraState("running");
        startingRef.current = false;

        if (onVideoReadyRef.current) {
          await onVideoReadyRef.current(video);
        }
      } catch (error) {
        startingRef.current = false;
        setCameraState("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Could not start the camera."
        );
      }
    }, [cameraState]);

    useImperativeHandle(
      ref,
      () => ({
        startCamera,
        stopCamera,
        getVideoElement: () => videoRef.current
      }),
      [startCamera, stopCamera]
    );

    useEffect(() => {
      return () => {
        if (streamRef.current) {
          for (const track of streamRef.current.getTracks()) {
            try {
              track.stop();
            } catch {}
          }
          streamRef.current = null;
        }

        const video = videoRef.current;
        if (video) {
          try {
            video.pause();
          } catch {}
          video.srcObject = null;
        }
      };
    }, []);

    const showOverlay = cameraState !== "running";

    return (
      <div
        className={className}
        style={{
          position: "relative",
          width: "100%",
          overflow: "hidden",
          borderRadius: 18,
          background: "#000",
          border: "1px solid rgba(255,255,255,0.08)",
          aspectRatio: "16 / 10"
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)"
          }}
        />

        {showOverlay && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.45)",
              padding: 20
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                textAlign: "center",
                color: "white"
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: "#d8e2ff",
                  marginBottom: showStartButton ? 16 : 0
                }}
              >
                {cameraState === "starting"
                  ? "Starting camera…"
                  : cameraState === "error"
                    ? "Camera unavailable"
                    : "Camera is off"}
              </div>

              {cameraState === "error" && errorMessage && (
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: "#ffb4b4",
                    marginBottom: showStartButton ? 16 : 0
                  }}
                >
                  {errorMessage}
                </div>
              )}

              {showStartButton && (
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  disabled={cameraState === "starting"}
                  style={{
                    background: "#9be7b0",
                    color: "#08111f",
                    fontWeight: 700,
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 14px",
                    cursor:
                      cameraState === "starting" ? "not-allowed" : "pointer",
                    opacity: cameraState === "starting" ? 0.65 : 1
                  }}
                >
                  {cameraState === "starting" ? "Starting…" : "Start Camera"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default CameraViewport;
