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
    const startInFlightRef = useRef(false);

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
      }

      streamRef.current = null;

      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {}
        videoRef.current.srcObject = null;
      }

      startInFlightRef.current = false;
      setCameraState("idle");
      setErrorMessage("");
      onCameraStop?.();
    }, [onCameraStop]);

    const startCamera = useCallback(async () => {
      if (startInFlightRef.current || cameraState === "running") {
        return;
      }

      startInFlightRef.current = true;
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

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          throw new Error("Video element is not available.");
        }

        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        video.autoplay = true;

        await video.play();

        setCameraState("running");
        startInFlightRef.current = false;

        await onVideoReady?.(video);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not start the camera.";

        setCameraState("error");
        setErrorMessage(message);
        startInFlightRef.current = false;
      }
    }, [cameraState, onVideoReady]);

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
        stopCamera();
      };
    }, [stopCamera]);

    const showOverlay = cameraState !== "running";

    return (
      <div
        className={className}
        style={{
          width: "100%",
          maxWidth: "100%",
          overflow: "hidden",
          borderRadius: 18,
          background: "black",
          border: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
          aspectRatio: "16 / 10"
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
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
              background:
                cameraState === "idle"
                  ? "rgba(0,0,0,0.42)"
                  : "rgba(0,0,0,0.55)",
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
                    marginBottom: 16
                  }}
                >
                  {errorMessage}
                </div>
              )}

              {showStartButton && (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    justifyContent: "center",
                    flexWrap: "wrap"
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void startCamera();
                    }}
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

                  {cameraState === "error" && (
                    <button
                      type="button"
                      onClick={stopCamera}
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        color: "white",
                        fontWeight: 600,
                        border: "none",
                        borderRadius: 10,
                        padding: "10px 14px",
                        cursor: "pointer"
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default CameraViewport;