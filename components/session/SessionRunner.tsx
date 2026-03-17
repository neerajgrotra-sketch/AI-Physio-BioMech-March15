"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import CameraViewport from "@/components/camera/CameraViewport";
import PoseCanvasOverlay from "@/components/camera/PoseCanvasOverlay";
import CoachingPanel from "@/components/coaching/CoachingPanel";
import DebugPanel from "@/components/debug/DebugPanel";
import { usePrescriptionLibrary } from "@/components/providers/PrescriptionLibraryProvider";

import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import type { ExerciseDefinitionId } from "@/lib/exercises/exerciseTypes";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement } from "@/lib/interpreter/movementInterpreter";
import { buildCoachingDecision } from "@/lib/coaching/coachingPolicy";
import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { CoachingDecision } from "@/lib/types/coaching";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { ExercisePrescription } from "@/lib/types/exercise";

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
  const { allPrescriptions } = usePrescriptionLibrary();

  const [selectedExerciseId, setSelectedExerciseId] =
    useState<string>("right-arm-raise");

  const prescription = useMemo(() => {
    return (
      allPrescriptions.find((item) => item.id === selectedExerciseId) ??
      allPrescriptions[0]
    );
  }, [selectedExerciseId, allPrescriptions]);

  const prescriptionRef = useRef<ExercisePrescription>(prescription);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const trackingActiveRef = useRef(false);
  const repStateRef = useRef<RuntimeRepState>(createInitialRepState());
  const featureHistoryRef = useRef(new FeatureHistory(5));

  const stickyCoachingUntilRef = useRef<number>(0);
  const stickyCoachingRef = useRef<CoachingDecision | null>(null);

  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(createEmptyFeatures());
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(null);
  const [coaching, setCoaching] = useState<CoachingDecision>(createIdleCoaching());
  const [engineStatus, setEngineStatus] = useState<
    "idle" | "loading" | "running" | "error"
  >("idle");
  const [engineError, setEngineError] = useState("");

  useEffect(() => {
    if (!allPrescriptions.find((item) => item.id === selectedExerciseId) && allPrescriptions[0]) {
      setSelectedExerciseId(allPrescriptions[0].id);
    }
  }, [allPrescriptions, selectedExerciseId]);

  useEffect(() => {
    prescriptionRef.current = prescription;
  }, [prescription]);

  function setStickyCoaching(decision: CoachingDecision, durationMs = 2200) {
    stickyCoachingRef.current = decision;
    stickyCoachingUntilRef.current = Date.now() + durationMs;
    setCoaching(decision);
  }

  function resetExerciseState() {
    repStateRef.current = createInitialRepState();
    featureHistoryRef.current.clear();
    stickyCoachingRef.current = null;
    stickyCoachingUntilRef.current = 0;

    setRepCount(0);
    setPhase("ready");
    setActiveMetricValue(null);
    setCoaching(createIdleCoaching());
  }

  function stopTracking() {
    trackingActiveRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    videoRef.current = null;

    setEngineStatus("idle");
    setEngineError("");
    setFrame(null);
    setFeatures(createEmptyFeatures());

    resetExerciseState();
  }

  async function beginTracking(video: HTMLVideoElement) {
    try {
      setEngineStatus("loading");
      setEngineError("");
      videoRef.current = video;
      trackingActiveRef.current = true;

      resetExerciseState();

      if (!detectorRef.current) {
        detectorRef.current = await createPoseDetector();
      }

      setEngineStatus("running");

      const loop = async () => {
        if (!trackingActiveRef.current) return;

        const liveVideo = videoRef.current;
        const detector = detectorRef.current;
        const activePrescription = prescriptionRef.current;

        if (!liveVideo || !detector) return;

        if (
          liveVideo.readyState < 2 ||
          liveVideo.videoWidth === 0 ||
          liveVideo.videoHeight === 0
        ) {
          rafRef.current = window.requestAnimationFrame(loop);
          return;
        }

        try {
          const poses = await detector.estimatePoses(liveVideo);

          if (!trackingActiveRef.current) return;

          const pose = poses[0] ?? null;

          const normalized = normalizePoseFrame(
            pose,
            liveVideo.videoWidth || 1,
            liveVideo.videoHeight || 1
          );

          setFrame(normalized);

          const rawFeatures = normalized.personDetected
            ? extractMovementFeatures(normalized)
            : createEmptyFeatures();

          if (normalized.personDetected) {
            featureHistoryRef.current.push(rawFeatures);
          } else {
            featureHistoryRef.current.clear();
          }

          const smoothedFeatures = normalized.personDetected
            ? smoothMovementFeatures(featureHistoryRef.current.getAll())
            : createEmptyFeatures();

          setFeatures(smoothedFeatures);

          const output = interpretMovement(
            repStateRef.current,
            smoothedFeatures,
            activePrescription,
            {
              timestampMs: Date.now(),
              personDetected: normalized.personDetected,
              balanceOk: true,
              activeMetricValue: null
            }
          );

          repStateRef.current = output.repState;

          setRepCount(output.repState.repCount);
          setPhase(output.repState.phase);
          setActiveMetricValue(output.activeMetricValue);

          const now = Date.now();

          if (output.repState.justFailedRep) {
            const failureDecision = buildCoachingDecision(output, activePrescription);
            setStickyCoaching(
              {
                ...failureDecision,
                message: `${failureDecision.message} Begin again when ready.`
              },
              2600
            );
          } else if (output.repState.justCompletedRep) {
            setStickyCoaching(
              {
                code: "good_rep",
                priority: "encourage",
                message: `${activePrescription.coaching.success} Begin again when ready.`
              },
              1800
            );
          } else if (output.repState.justCompletedHold) {
            setStickyCoaching(
              {
                code: "hold_complete",
                priority: "encourage",
                message: activePrescription.coaching.lower
              },
              1200
            );
          } else if (output.holdRemainingMs !== null) {
            const seconds = Math.max(1, Math.ceil(output.holdRemainingMs / 1000));
            setCoaching({
              code: "keep_holding",
              priority: "info",
              message: `Hold ${seconds}`
            });
          } else if (stickyCoachingRef.current && now < stickyCoachingUntilRef.current) {
            setCoaching(stickyCoachingRef.current);
          } else {
            stickyCoachingRef.current = null;
            stickyCoachingUntilRef.current = 0;
            setCoaching(buildCoachingDecision(output, activePrescription));
          }
        } catch (error) {
          if (!trackingActiveRef.current) return;

          const message =
            error instanceof Error ? error.message : String(error);

          if (
            message.toLowerCase().includes("aborted") ||
            message.toLowerCase().includes("abort")
          ) {
            return;
          }

          setEngineStatus("error");
          setEngineError(message || "Pose estimation failed.");
          return;
        }

        if (trackingActiveRef.current) {
          rafRef.current = window.requestAnimationFrame(loop);
        }
      };

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(loop);
    } catch (error) {
      trackingActiveRef.current = false;
      setEngineStatus("error");
      setEngineError(
        error instanceof Error ? error.message : "Could not initialize pose detector."
      );
    }
  }

  function resetExercise() {
    resetExerciseState();
  }

  useEffect(() => {
    resetExerciseState();
  }, [selectedExerciseId]);

  useEffect(() => {
    return () => {
      stopTracking();
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
            Start the camera and perform the selected exercise.
          </p>

          <div style={{ position: "relative", width: "100%", maxWidth: 640 }}>
            <CameraViewport
              onVideoReady={beginTracking}
              onCameraStop={stopTracking}
            />

            <div
              style={{
                position: "absolute",
                left: 0,
                top: 52,
                width: "100%",
                maxWidth: 640,
                height: 420,
                pointerEvents: "none"
              }}
            >
              <PoseCanvasOverlay frame={frame} width={640} height={420} />
            </div>
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

            <div style={{ marginBottom: 14 }}>
              <label
                htmlFor="exercise-select"
                style={{ display: "block", marginBottom: 6, fontSize: 14 }}
              >
                Exercise
              </label>
              <select
                id="exercise-select"
                value={selectedExerciseId}
                onChange={(e) => setSelectedExerciseId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#121933",
                  color: "white"
                }}
              >
                {allPrescriptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <h3 style={{ marginTop: 0 }}>{prescription.name}</h3>
            <p style={{ color: "#aab6d3", marginBottom: 10 }}>
              {prescription.description}
            </p>

            <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
              <div>
                Target: <strong>{prescription.target.label}</strong>
              </div>
              {prescription.hold.required && (
                <div>
                  Hold: <strong>{prescription.hold.durationMs / 1000}s</strong>
                </div>
              )}
              <div>
                Reps: <strong>{prescription.repTarget}</strong>
              </div>
              {prescription.tempo?.label && (
                <div>
                  Tempo: <strong>{prescription.tempo.label}</strong>
                </div>
              )}
              <div>
                Template: <strong>{prescription.template}</strong>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 14, fontSize: 14 }}>
              <div>
                Engine status: <strong>{engineStatus}</strong>
              </div>
              <div>
                Phase: <strong>{phase}</strong>
              </div>
              <div>
                Reps done: <strong>{repCount} / {prescription.repTarget}</strong>
              </div>
              <div>
                Active metric: <strong>{activeMetricValue ?? "—"}</strong>
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
