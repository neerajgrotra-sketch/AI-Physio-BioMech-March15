// ============================================================
// lib/session/useInferenceLoop.ts
// ============================================================
// Owns the camera inference loop and wires all intelligence
// layers into it.
//
// Responsibilities:
// - Start / stop the pose detection loop
// - Extract and smooth movement features
// - Run the movement interpreter
// - Feed the framing monitor every 2 seconds
// - Feed the coaching brain every frame
// - Fire coaching events at key moments
// - Signal exercise completion to SessionRunner
//
// SessionRunner calls:
// - startLoop(video, prescription)  → when camera is ready
// - stopLoop()                       → when session ends
//
// SessionRunner reads:
// - frame, features, phase, repCount, holdRemainingMs
// - engineStatus, engineError
// - liveObservation (what the camera sees panel)
// ============================================================

import { useRef, useState, useCallback } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";

import { createPoseDetector } from "@/lib/pose/createPoseDetector";
import { normalizePoseFrame } from "@/lib/pose/normalizePoseFrame";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement } from "@/lib/interpreter/movementInterpreter";

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { PatientProfile, ExerciseSessionContext } from "@/lib/patient/patientTypes";

// ============================================================
// EMPTY FEATURES FACTORY
// ============================================================

export function createEmptyFeatures(): MovementFeatures {
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
    leftWristToShoulderDy: null,
    hipCenterY: null,
    hipHeightNormalized: null,
    kneeAngleLeft: null,
    kneeAngleRight: null,
    hipVelocityY: null,
    isStanding: false,
    isSeated: false
  };
}

// ============================================================
// LIVE OBSERVATION TYPE
// ============================================================

export type LiveObservation = {
  visibilityLines: string[];
  movementLines: string[];
};

// ============================================================
// VISIBILITY BUILDERS
// (moved here from SessionRunner)
// ============================================================

function getVisibleLandmarkNames(frame: PoseFrame | null): Set<string> {
  const names = new Set<string>();
  const landmarks = (frame as any)?.landmarks ?? null;
  if (!landmarks) return names;

  for (const [key, value] of Object.entries(landmarks)) {
    const point = value as { x?: number; y?: number; score?: number | null };
    if (
      typeof point?.x === "number" &&
      typeof point?.y === "number" &&
      (point.score ?? 1) >= 0.15
    ) {
      names.add(key);
    }
  }
  return names;
}

function buildVisibilityLines(
  frame: PoseFrame | null,
  readinessMessage: string,
  readinessReady: boolean
): string[] {
  const lines: string[] = [];
  const names = getVisibleLandmarkNames(frame);
  const personDetected = Boolean((frame as any)?.personDetected);

  if (!personDetected) return ["No person detected in frame."];

  lines.push("Person detected.");
  lines.push(names.has("nose") ? "Head visible." : "Head not clearly visible.");
  lines.push(
    names.has("left_shoulder") && names.has("right_shoulder")
      ? "Shoulders visible."
      : "Shoulders not clearly visible."
  );
  lines.push(
    names.has("left_elbow") || names.has("right_elbow")
      ? "At least one elbow visible."
      : "Elbows not clearly visible."
  );
  lines.push(
    names.has("left_wrist") || names.has("right_wrist")
      ? "At least one wrist visible."
      : "Wrists not clearly visible."
  );
  lines.push(
    names.has("left_hip") && names.has("right_hip")
      ? "Torso and hips visible."
      : "Hips not clearly visible."
  );
  lines.push(
    names.has("left_knee") || names.has("right_knee")
      ? "Lower body partially visible."
      : "Lower body mostly out of frame."
  );
  lines.push(readinessReady ? "Framing is acceptable." : readinessMessage);

  return lines;
}

function buildMovementLines(
  prescription: ExercisePrescription | null,
  phase: string,
  features: MovementFeatures,
  repCount: number,
  holdRemainingMs: number | null,
  primaryIssue: string,
  activeMetricValue: number | null
): string[] {
  const lines: string[] = [];

  if (features.isStanding) lines.push("User appears to be standing.");
  else if (features.isSeated) lines.push("User appears to be seated.");
  else lines.push("Posture state is not fully clear yet.");

  const phaseLabels: Record<string, string> = {
    ready: "ready to begin",
    lifting: "lifting phase",
    holding: "hold in progress",
    lowering: "lowering phase",
    complete: "exercise complete"
  };
  lines.push(`Movement status: ${phaseLabels[phase] ?? "tracking"}.`);

  if (prescription?.id === "right-arm-raise") {
    const angle = features.rightArmElevationDeg;
    if (angle !== null) {
      if (angle < 35) lines.push("Right arm is still below target height.");
      else if (angle < 75) lines.push("Right arm is approaching shoulder height.");
      else lines.push("Right arm is near or above target height.");
    }
  } else if (prescription?.id === "left-arm-raise") {
    const angle = features.leftArmElevationDeg;
    if (angle !== null) {
      if (angle < 35) lines.push("Left arm is still below target height.");
      else if (angle < 75) lines.push("Left arm is approaching shoulder height.");
      else lines.push("Left arm is near or above target height.");
    }
  } else if (prescription?.id === "both-arm-raise") {
    const angle = features.bilateralArmElevationDeg;
    if (angle !== null) {
      if (angle < 35) lines.push("Both arms are still below target height.");
      else if (angle < 75) lines.push("Both arms are approaching shoulder height.");
      else lines.push("Both arms are near or above target height.");
    }
  } else if (prescription?.id === "sit-to-stand") {
    lines.push(
      features.isStanding
        ? "User is near the standing position."
        : "User is near the seated position."
    );
  }

  if (holdRemainingMs !== null && phase === "holding") {
    lines.push(
      `Hold time remaining: ${Math.max(1, Math.ceil(holdRemainingMs / 1000))} second(s).`
    );
  }

  lines.push(`Rep count: ${repCount} completed.`);

  if (activeMetricValue !== null) {
    lines.push(`Active metric value: ${activeMetricValue.toFixed(1)}.`);
  }

  if (primaryIssue && primaryIssue !== "idle") {
    lines.push(
      `Primary quality note: ${primaryIssue.replaceAll("_", " ")}.`
    );
  }

  return lines;
}

// ============================================================
// COACHING EVENT CALLBACKS TYPE
// ============================================================
// SessionRunner passes these down so the inference loop
// can fire coaching events without depending on the brain.
// ============================================================

export type CoachingEventCallbacks = {
  onRepCompleted: (nowMs: number) => void;
  onRepFailed: (failureReason: string, nowMs: number) => void;
  onHoldStarted: (holdRequiredMs: number, nowMs: number) => void;
  onExerciseStarted: (nowMs: number) => void;
  feedFrame: (params: {
    phase: string;
    repCount: number;
    holdElapsedMs: number | null;
    holdRequiredMs: number | null;
    primaryIssue: string;
    armElevation?: number | null;
    nowMs: number;
  }) => void;
};

// ============================================================
// FRAMING EVENT CALLBACKS
// ============================================================

export type FramingEventCallbacks = {
  evaluateFraming: (
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ) => void;
  cancelPendingEval: () => void;
};

// ============================================================
// HOOK
// ============================================================

export function useInferenceLoop() {
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const trackingActiveRef = useRef(false);
  const exerciseCompleteFiredRef = useRef(false);  // prevent repeated complete events

  const repStateRef = useRef<RuntimeRepState>(createInitialRepState());
  const featureHistoryRef = useRef(new FeatureHistory(5));

  // Track previous phase to detect transitions
  const prevPhaseRef = useRef<string>("ready");
  // Track hold entry time for holdElapsedMs calculation
  const holdEnteredAtMsRef = useRef<number | null>(null);
  // Spike filter: tracks previous frame metric to reject impossible jumps (>50° per frame)
  const prevMetricValueRef = useRef<number | null>(null);

  // ── Dynamic rest baseline calibration ─────────────────────────────────────
  // Sample activeMetricValue for 2s after exercise start to compute the true
  // resting position. TensorFlow's angle measurements have a ~20° offset at
  // rest that varies with camera distance and patient posture.
  // Once calibrated, all thresholds are offset from the real baseline.
  const calibrationSamplesRef = useRef<number[]>([]);
  const calibrationCompleteRef = useRef<boolean>(false);
  const calibrationBaselineRef = useRef<number>(0);
  const calibrationStartMsRef = useRef<number | null>(null);
  const calibrationWindowMs = 2000; // sample for 2 seconds
  // State mirror of calibrationBaselineRef — exported for ROM score ring
  // (ref is used internally for zero-cost reads in the rAF loop)
  const [calibrationBaseline, setCalibrationBaseline] = useState<number>(0);

  const [engineStatus, setEngineStatus] = useState<
    "idle" | "loading" | "running" | "error"
  >("idle");
  const [engineError, setEngineError] = useState("");
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [features, setFeatures] = useState<MovementFeatures>(
    createEmptyFeatures()
  );
  const [phase, setPhase] = useState("ready");
  const [repCount, setRepCount] = useState(0);
  const [holdRemainingMs, setHoldRemainingMs] = useState<number | null>(null);
  const [activeMetricValue, setActiveMetricValue] = useState<number | null>(
    null
  );
  const [lastPrimaryIssue, setLastPrimaryIssue] = useState("idle");
  const [liveObservation, setLiveObservation] = useState<LiveObservation>({
    visibilityLines: ["Camera is off."],
    movementLines: ["No movement is being tracked yet."]
  });

  // ----------------------------------------------------------
  // RESET TRACKING STATE
  // ----------------------------------------------------------

  const resetTrackingState = useCallback(() => {
    exerciseCompleteFiredRef.current = false;
    repStateRef.current = createInitialRepState();
    featureHistoryRef.current.clear();
    prevPhaseRef.current = "ready";
    holdEnteredAtMsRef.current = null;
    prevMetricValueRef.current = null; // reset spike filter on each exercise

    // Reset calibration for new exercise
    calibrationSamplesRef.current = [];
    calibrationCompleteRef.current = false;
    calibrationBaselineRef.current = 0;
    calibrationStartMsRef.current = null;
    setCalibrationBaseline(0);

    setPhase("ready");
    setRepCount(0);
    setHoldRemainingMs(null);
    setActiveMetricValue(null);
    setLastPrimaryIssue("idle");
    setLiveObservation({
      visibilityLines: ["Waiting for camera input."],
      movementLines: ["No movement is being tracked yet."]
    });
  }, []);

  // ----------------------------------------------------------
  // STOP LOOP
  // ----------------------------------------------------------

  const stopLoop = useCallback(() => {
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
    resetTrackingState();
  }, [resetTrackingState]);

  // ----------------------------------------------------------
  // START LOOP
  // ----------------------------------------------------------

  const startLoop = useCallback(
    async (
      video: HTMLVideoElement,
      getPrescription: () => ExercisePrescription | null,
      onExerciseComplete: () => void,
      coachingCallbacks: CoachingEventCallbacks,
      framingCallbacks: FramingEventCallbacks,
      readinessEvaluator: (
        frame: PoseFrame | null,
        features: MovementFeatures,
        prescription: ExercisePrescription
      ) => { ready: boolean; message: string }
    ) => {
      try {
        setEngineStatus("loading");
        setEngineError("");
        videoRef.current = video;
        trackingActiveRef.current = true;

        resetTrackingState();

        if (!detectorRef.current) {
          detectorRef.current = await createPoseDetector();
        }

        setEngineStatus("running");

        // Fire exercise started coaching event
        coachingCallbacks.onExerciseStarted(Date.now());

        const loop = async () => {
          if (!trackingActiveRef.current) return;

          const liveVideo = videoRef.current;
          const detector = detectorRef.current;
          const activePrescription = getPrescription();

          if (!liveVideo || !detector || !activePrescription) {
            if (trackingActiveRef.current) {
              rafRef.current = window.requestAnimationFrame(loop);
            }
            return;
          }

          if (
            liveVideo.readyState < 2 ||
            liveVideo.videoWidth === 0 ||
            liveVideo.videoHeight === 0
          ) {
            rafRef.current = window.requestAnimationFrame(loop);
            return;
          }

          try {
            const nowMs = Date.now();
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

            // ── Dynamic Rest Baseline Calibration ─────────────────────────
            // During the first 2 seconds while the patient is at rest (before
            // any movement is detected), sample the active metric to compute
            // the true resting baseline. This corrects TensorFlow's ~20° offset
            // which varies with camera distance, posture, and patient size.
            // All thresholds are then offset from this real measured baseline.
            if (normalized.personDetected && !calibrationCompleteRef.current) {
              // Start calibration timer on first detected person
              if (calibrationStartMsRef.current === null) {
                calibrationStartMsRef.current = nowMs;
              }

              // Compute raw metric value for this frame
              const rawMetricForCalib = (() => {
                const id = activePrescription.id;
                const f = smoothedFeatures;
                if (id.includes("flexion")) {
                  if (id.includes("right")) return f.rightArmElevationDeg;
                  if (id.includes("left")) return f.leftArmElevationDeg;
                  return f.bilateralArmElevationDeg;
                }
                if (id.includes("abduction")) {
                  if (id.includes("right")) return f.rightArmElevationDeg;
                  if (id.includes("left")) return f.leftArmElevationDeg;
                  return f.bilateralArmElevationDeg;
                }
                return null;
              })();

              if (rawMetricForCalib !== null && rawMetricForCalib > 0) {
                calibrationSamplesRef.current.push(rawMetricForCalib);
              }

              // After calibration window, compute baseline and update thresholds
              if (nowMs - calibrationStartMsRef.current >= calibrationWindowMs) {
                const samples = calibrationSamplesRef.current;
                if (samples.length >= 5) {
                  // Use median to avoid outliers
                  const sorted = [...samples].sort((a, b) => a - b);
                  const baseline = sorted[Math.floor(sorted.length / 2)];
                  calibrationBaselineRef.current = baseline;
                  calibrationCompleteRef.current = true;
                  setCalibrationBaseline(baseline); // mirrors ref for external consumers

                  // Recompute thresholds offset from real resting baseline.
                  // romStart (e.g. 0°) is the anatomical rest — baseline is what
                  // TensorFlow actually reads at that anatomical position.
                  // We shift all thresholds by (baseline - romStart).
                  const romStart = (activePrescription as any).romStartDegrees ?? 0;
                  const offset = Math.max(0, baseline - romStart);
                  const romMin = (activePrescription as any).romAcceptableMin;

                  // Fix B: physio override (romTargetDegrees) takes priority over
                  // population-level romAcceptableMin. buildPrescription already set
                  // targetThreshold = romTargetDegrees ?? romMin, but calibration was
                  // overwriting it back to romMin. Use the same priority here.
                  const physioTarget = (activePrescription as any).romTargetDegrees ?? null;
                  const effectiveTarget = physioTarget ?? romMin;

                  if (effectiveTarget != null) {
                    // startThreshold: must be comfortably above baseline noise.
                    // TF resting jitter is ±3–5°, so +15° gives clear separation.
                    const start = baseline + 15;

                    // targetThreshold: used to TRIGGER hold entry (TOP phase).
                    // Uses physio override if set, otherwise population min.
                    // This is what the patient must reach for the hold to start.
                    const target = effectiveTarget + offset;

                    // finishThreshold: used during LOWERING to detect arms returned to rest.
                    // Must be above resting noise floor (baseline ± 3-5°).
                    const finish = Math.max(0, baseline + 10);

                    // CRITICAL: Also set target.tolerance on the prescription so HOLDING
                    // phase allows metric to drop from physio target back toward romMin
                    // without immediately failing. Without this, a physio target of 135°+
                    // calibrated offset makes hold impossible to sustain.
                    // holdSustainFloor = romAcceptableMin + offset (population-level floor)
                    // tolerance = target - holdSustainFloor (gap between trigger and floor)
                    const holdSustainFloor = (romMin ?? 110) + offset;
                    const holdTolerance = Math.max(10, target - holdSustainFloor);

                    (activePrescription as any).startThreshold = start;
                    (activePrescription as any).targetThreshold = target;
                    (activePrescription as any).finishThreshold = finish;
                    activePrescription.startThreshold = start;
                    activePrescription.targetThreshold = target;
                    activePrescription.finishThreshold = finish;
                    // Update tolerance so hold sustains down to romAcceptableMin + offset
                    if (activePrescription.target) {
                      activePrescription.target.tolerance = holdTolerance;
                    }

                    // ── CALIBRATION DEBUG LOG ──────────────────────────────
                    // This fires ONCE per exercise after calibration completes.
                    // If you see wrong threshold values here, the calibration
                    // window captured bad samples (patient was moving).
                    console.log(
                      `[CALIBRATION COMPLETE] ex=${activePrescription.id}` +
                      ` | baseline=${baseline.toFixed(1)}°` +
                      ` | offset=${offset.toFixed(1)}°` +
                      ` | samples=${samples.length}` +
                      ` | start=${start.toFixed(1)}°` +
                      ` | target=${target.toFixed(1)}°` +
                      ` | finish=${finish.toFixed(1)}°` +
                      ` | holdTolerance=${holdTolerance.toFixed(1)}°` +
                      ` | holdFloor=${holdSustainFloor.toFixed(1)}°` +
                      ` | physioTarget=${physioTarget ?? "population"}` +
                      ` | verify: prescription.finishThreshold=${activePrescription.finishThreshold.toFixed(1)}°`
                    );
                  }
                } else {
                  // Not enough samples — mark complete to avoid blocking
                  calibrationCompleteRef.current = true;
                }
              }
            }

            // ── Spike filter ───────────────────────────────────────────────
            // TensorFlow occasionally produces single-frame landmark jumps that
            // cause the metric to spike 50°+ in one frame (e.g. 15° → 103°).
            // These spikes cause premature hold triggers. The interpreter reads
            // metric from smoothedFeatures directly, so we clamp the relevant
            // field back to the previous known-good value on spike frames.
            const rawMetricThisFrame = (() => {
              const id = activePrescription.id;
              const f = smoothedFeatures;
              if (id.includes("flexion") || id.includes("abduction")) {
                if (id.includes("right")) return f.rightArmElevationDeg;
                if (id.includes("left")) return f.leftArmElevationDeg;
                return f.bilateralArmElevationDeg;
              }
              return null;
            })();

            const SPIKE_THRESHOLD_DEG = 50;
            if (
              rawMetricThisFrame !== null &&
              prevMetricValueRef.current !== null &&
              Math.abs(rawMetricThisFrame - prevMetricValueRef.current) > SPIKE_THRESHOLD_DEG
            ) {
              // Clamp the spiked field back to previous value so the interpreter
              // sees a stable reading — do not update prevMetricValueRef this frame
              const id = activePrescription.id;
              const prev = prevMetricValueRef.current;
              if (id.includes("flexion") || id.includes("abduction")) {
                if (id.includes("right")) smoothedFeatures.rightArmElevationDeg = prev;
                else if (id.includes("left")) smoothedFeatures.leftArmElevationDeg = prev;
                else {
                  smoothedFeatures.bilateralArmElevationDeg = prev;
                  smoothedFeatures.rightArmElevationDeg = prev;
                  smoothedFeatures.leftArmElevationDeg = prev;
                }
              }
            } else if (rawMetricThisFrame !== null) {
              prevMetricValueRef.current = rawMetricThisFrame;
            }

            // Run movement interpreter
            const output = interpretMovement(
              repStateRef.current,
              smoothedFeatures,
              activePrescription,
              {
                timestampMs: nowMs,
                personDetected: normalized.personDetected,
                balanceOk: true,
                activeMetricValue: null
              }
            );

            repStateRef.current = output.repState;

            const currentPhase = output.repState.phase;
            const prevPhase = prevPhaseRef.current;

            setPhase(currentPhase);
            setRepCount(output.repState.repCount);
            setHoldRemainingMs(output.holdRemainingMs);
            setActiveMetricValue(output.activeMetricValue);
            setLastPrimaryIssue(output.primaryIssue);

            // ------------------------------------------------
            // PHASE TRANSITION EVENTS
            // Fire coaching events at key phase transitions
            // ------------------------------------------------

            // Cancel any in-flight framing evaluation the moment patient
            // starts moving — prevents stale API responses from interrupting
            // active reps with "step back" instructions mid-hold
            if (prevPhase === "ready" && currentPhase === "lifting") {
              framingCallbacks.cancelPendingEval();
            }

            // Hold just started
            if (
              prevPhase !== "holding" &&
              currentPhase === "holding" &&
              activePrescription.hold.required
            ) {
              holdEnteredAtMsRef.current = nowMs;
              coachingCallbacks.onHoldStarted(
                activePrescription.hold.durationMs,
                nowMs
              );
            }

            // Hold ended — reset entry time
            if (prevPhase === "holding" && currentPhase !== "holding") {
              holdEnteredAtMsRef.current = null;
            }

            // Rep just completed
            if (output.repState.justCompletedRep) {
              // ── REP RESOLUTION DEBUG LOG ───────────────────────────────
              // Confirms what finishThreshold was when LOWERING resolved.
              // If this shows a high value (~110+), calibration write didn't stick.
              console.log(
                `[REP COMPLETE] rep=${output.repState.repCount}` +
                ` | metric=${output.activeMetricValue?.toFixed(1) ?? "?"}°` +
                ` | finishThreshold=${activePrescription.finishThreshold.toFixed(1)}°` +
                ` | targetThreshold=${activePrescription.targetThreshold.toFixed(1)}°` +
                ` | startThreshold=${activePrescription.startThreshold.toFixed(1)}°` +
                ` | calib_baseline=${calibrationBaselineRef.current.toFixed(1)}°`
              );
              coachingCallbacks.onRepCompleted(nowMs);
            }

            // Rep just failed
            if (output.repState.justFailedRep) {
              const reason = output.repState.lastRepEvaluation.reason ?? "unknown";
              console.log(
                `[REP FAILED] reason=${reason}` +
                ` | metric=${output.activeMetricValue?.toFixed(1) ?? "?"}°` +
                ` | finishThreshold=${activePrescription.finishThreshold.toFixed(1)}°` +
                ` | targetThreshold=${activePrescription.targetThreshold.toFixed(1)}°` +
                ` | calib_baseline=${calibrationBaselineRef.current.toFixed(1)}°`
              );
              coachingCallbacks.onRepFailed(reason, nowMs);
            }

            prevPhaseRef.current = currentPhase;

            // ------------------------------------------------
            // HOLD ELAPSED CALCULATION
            // ------------------------------------------------
            const holdElapsedMs =
              holdEnteredAtMsRef.current !== null
                ? nowMs - holdEnteredAtMsRef.current
                : null;

            // ------------------------------------------------
            // ARM ELEVATION FOR OBSERVATION BUFFER
            // Maps to the correct metric based on exercise slug.
            // Supports both old slugs and new DB slugs.
            // ------------------------------------------------
            const armElevation = (() => {
              const id = activePrescription.id;
              const f = smoothedFeatures;
              // Shoulder flexion — forward raise
              if (id === "right-arm-raise" || id === "shoulder_flexion_right")
                return f.rightArmElevationDeg;
              if (id === "left-arm-raise" || id === "shoulder_flexion_left")
                return f.leftArmElevationDeg;
              if (id === "both-arm-raise" || id === "shoulder_flexion_bilateral")
                return f.bilateralArmElevationDeg;
              // Shoulder abduction — sideways raise (uses same elevation metric)
              if (id === "shoulder_abduction_right") return f.rightArmElevationDeg;
              if (id === "shoulder_abduction_left") return f.leftArmElevationDeg;
              if (id === "shoulder_abduction_bilateral") return f.bilateralArmElevationDeg;
              // Knee extension — use elbow angle as proxy for knee angle
              if (id === "knee_extension_right") return f.rightElbowAngleDeg;
              if (id === "knee_extension_left") return f.leftElbowAngleDeg;
              if (id === "knee_extension_bilateral") return f.bilateralArmElevationDeg;
              // Sit to stand — hip height
              if (id === "sit-to-stand" || id === "sit_to_stand")
                return f.hipHeightNormalized != null ? f.hipHeightNormalized * 100 : null;
              return null;
            })();

            // ------------------------------------------------
            // FEED COACHING BRAIN (every frame)
            // ------------------------------------------------
            coachingCallbacks.feedFrame({
              phase: currentPhase,
              repCount: output.repState.repCount,
              holdElapsedMs,
              holdRequiredMs: activePrescription.hold.required
                ? activePrescription.hold.durationMs
                : null,
              primaryIssue: output.primaryIssue,
              armElevation,
              nowMs
            });

            // ------------------------------------------------
            // FEED FRAMING MONITOR (ready phase only)
            // ------------------------------------------------
            // Critical fix: framing evaluator must NEVER fire during active
            // reps (lifting/holding/lowering). It calls Claude API and disrupts
            // the session mid-rep. Gate to ready phase only — one-time check
            // per exercise is sufficient and was already the clinical intent.
            if (currentPhase === "ready") {
              framingCallbacks.evaluateFraming(
                normalized,
                smoothedFeatures,
                activePrescription,
                nowMs
              );
            }

            // ------------------------------------------------
            // READINESS FOR LIVE OBSERVATION PANEL
            // ------------------------------------------------
            const readiness = readinessEvaluator(
              normalized,
              smoothedFeatures,
              activePrescription
            );

            setLiveObservation({
              visibilityLines: buildVisibilityLines(
                normalized,
                readiness.message,
                readiness.ready
              ),
              movementLines: buildMovementLines(
                activePrescription,
                currentPhase,
                smoothedFeatures,
                output.repState.repCount,
                output.holdRemainingMs,
                output.primaryIssue,
                output.activeMetricValue
              )
            });

            // ------------------------------------------------
            // EXERCISE COMPLETE
            // ------------------------------------------------
            if (output.isComplete && !exerciseCompleteFiredRef.current) {
              exerciseCompleteFiredRef.current = true;
              onExerciseComplete();
            }
          } catch (error) {
            if (!trackingActiveRef.current) return;

            const message =
              error instanceof Error ? error.message : String(error);

            if (
              message.toLowerCase().includes("aborted") ||
              message.toLowerCase().includes("abort")
            ) {
              if (trackingActiveRef.current) {
                rafRef.current = window.requestAnimationFrame(loop);
              }
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
          error instanceof Error
            ? error.message
            : "Could not initialize pose detector."
        );
      }
    },
    [resetTrackingState]
  );

  return {
    // State
    engineStatus,
    engineError,
    frame,
    features,
    phase,
    repCount,
    holdRemainingMs,
    activeMetricValue,
    lastPrimaryIssue,
    liveObservation,
    // Calibrated resting baseline (degrees) as state — triggers re-render when set
    calibrationBaseline,
    // Also expose as ref — rAF loop reads .current synchronously without waiting for re-render
    calibrationBaselineRef,

    // Actions
    startLoop,
    stopLoop,
    resetTrackingState
  };
}
