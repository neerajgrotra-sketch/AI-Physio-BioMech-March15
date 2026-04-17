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
    rightShoulderAbductionDeg: null,
    leftShoulderAbductionDeg: null,
    bilateralShoulderAbductionDeg: null,
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
  onRepCompleted: (nowMs: number, peakMetric: number | null, holdDurationMs: number | null) => void;
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
  // Returns the most recent prerequisite result — read via ref, zero cost.
  getPrerequisiteResult: () => { allMet: boolean; failures: Array<{ id: string; patientMessage: string; clinicalNote: string }> };
};

// ============================================================
// PREREQUISITE RETRY MESSAGE BUILDER
// ============================================================
// Shorter, more specific follow-up for each failure type.
// Fired once after PREREQ_RETRY_DELAY_MS of silence.

function buildPrereqRetryMessage(failureId: string): string {
  switch (failureId) {
    case "coverage_full_body":        return "I still can't see your feet — try stepping a little further back.";
    case "coverage_torso_hips":       return "I still need to see your knees — move the camera down or step back.";
    case "coverage_upper_body":       return "I still can't see your shoulders — step back from the camera.";
    case "posture_must_be_seated":    return "Please sit down in your chair before we start.";
    case "posture_must_be_standing":  return "Please stand up straight before we begin.";
    case "posture_indeterminate":     return "Sit fully back in the chair so I can confirm your position.";
    case "side_landmarks_right":      return "Make sure your full right arm is visible — shoulder to wrist.";
    case "side_landmarks_left":       return "Make sure your full left arm is visible — shoulder to wrist.";
    case "side_landmarks_bilateral":  return "Step back so both arms are fully in frame.";
    case "side_landmarks_bilateral_right": return "Shift slightly left so your right arm is fully visible.";
    case "side_landmarks_bilateral_left":  return "Shift slightly right so your left arm is fully visible.";
    case "bilateral_asymmetry":       return "Centre yourself so both arms are equally in view.";
    default:                          return "Adjust your position so I can see you clearly.";
  }
}

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
  // Peak metric reached during current rep (reset on READY→LIFTING, updated each LIFTING/HOLDING frame)
  // Passed to onRepCompleted so session results can store the actual achieved ROM
  const peakMetricThisRepRef = useRef<number | null>(null);
  // Hold duration for current rep (ms) — captured when HOLDING→LOWERING transition fires
  const lastHoldDurationMsRef = useRef<number | null>(null);
  // Frame counter for throttled debug logging
  const debugFrameCountRef = useRef<number>(0);

  // ── Prerequisite voice state machine ──────────────────────────────────────
  // States: "unsaid" → "spoken_initial" → "waiting" → "spoken_retry" → "exhausted"
  // Speaks the initial instruction once, waits 12s silently, speaks a shorter
  // retry once, then goes exhausted (visual panel only — no more speech).
  // Resets when the failure type changes or prerequisites are met.
  const prereqVoiceStateRef   = useRef<"unsaid" | "spoken_initial" | "waiting" | "spoken_retry" | "exhausted">("unsaid");
  const prereqVoiceSpokenAtMs = useRef<number | null>(null);
  const prereqLastFailureId   = useRef<string | null>(null);
  const PREREQ_RETRY_DELAY_MS = 12000;

  // ── Dynamic rest baseline calibration ─────────────────────────────────────
  // Sample activeMetricValue for 2s after exercise start to compute the true
  // resting position. TensorFlow's angle measurements have a ~20° offset at
  // rest that varies with camera distance and patient posture.
  // Once calibrated, all thresholds are offset from the real baseline.
  const calibrationSamplesRef = useRef<number[]>([]);
  const calibrationCompleteRef = useRef<boolean>(false);
  const calibrationBaselineRef = useRef<number>(0);
  const calibrationStartMsRef = useRef<number | null>(null);
  const calibrationWindowMs = 3000; // sample for 3 seconds — more resting frames
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
    peakMetricThisRepRef.current = null;
    lastHoldDurationMsRef.current = null;
    debugFrameCountRef.current = 0;
    prereqVoiceStateRef.current   = "unsaid";
    prereqVoiceSpokenAtMs.current = null;
    prereqLastFailureId.current   = null;

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
                // Skip calibration sampling for abduction — fixed thresholds used instead
                if (id.includes("abduction")) return null;
                if (id.includes("flexion")) {
                  if (id.includes("right")) return f.rightArmElevationDeg;
                  if (id.includes("left")) return f.leftArmElevationDeg;
                  return f.bilateralArmElevationDeg;
                }
                return null;
              })();

              // Abduction uses fixed thresholds — bypass dynamic calibration entirely.
              // The wrist-based metric has a predictable resting floor of ~5-8°.
              // Dynamic calibration fails for abduction because patients are often
              // already moving during the calibration window.
              if (activePrescription.id.includes("abduction") && !calibrationCompleteRef.current) {
                calibrationCompleteRef.current = true;
                calibrationBaselineRef.current = 8; // known resting floor
                setCalibrationBaseline(8);
                // Fixed thresholds: start=25° (well above rest), target=physioTarget or 80°,
                // finish=20° (clearly back at rest)
                const physioTargetAbd = (activePrescription as any).romTargetDegrees ?? null;
                const abdTarget = physioTargetAbd ?? 80;
                activePrescription.startThreshold = 25;
                activePrescription.targetThreshold = abdTarget;
                activePrescription.finishThreshold = 20;
                if (activePrescription.target) {
                  activePrescription.target.tolerance = 15;
                }
                console.log(
                  `[CALIBRATION COMPLETE] ex=${activePrescription.id}` +
                  ` | mode=FIXED (abduction)` +
                  ` | start=25.0° | target=${abdTarget.toFixed(1)}° | finish=20.0°` +
                  ` | physioTarget=${physioTargetAbd ?? "none — using 80°"}`
                );
              }

              if (rawMetricForCalib !== null && rawMetricForCalib > 0) {
                calibrationSamplesRef.current.push(rawMetricForCalib);
              }

              // After calibration window, compute baseline and update thresholds
              if (nowMs - calibrationStartMsRef.current >= calibrationWindowMs) {
                const samples = calibrationSamplesRef.current;
                if (samples.length >= 5) {
                  // Use 10th percentile (not median) to find true resting baseline.
                  // At rest the metric is at its minimum. Any movement during the
                  // calibration window only pushes values higher. The 10th percentile
                  // reliably captures the resting floor even if the patient starts
                  // moving partway through the 2s window.
                  const sorted = [...samples].sort((a, b) => a - b);
                  const p10Index = Math.floor(sorted.length * 0.10);
                  const baseline = sorted[p10Index];
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
                    const start = baseline + 15;

                    // For abduction exercises using the new wrist-based metric:
                    // The metric reads ~5-8° at rest and scales naturally with arm elevation.
                    // physioTarget is set in clinical degrees relative to anatomical zero.
                    // Add only the small resting offset (baseline) not the full population offset.
                    const isAbduction = activePrescription.id.includes("abduction");
                    const target = isAbduction
                      ? effectiveTarget + offset  // offset is small (~5-8°) for abduction — correct
                      : effectiveTarget + offset; // flexion: same formula, larger offset (~15-20°)

                    // finishThreshold: used during LOWERING to detect arms returned to rest.
                    // Must be above resting noise floor (baseline ± 3-5°).
                    const finish = Math.max(0, baseline + 10);

                    // CRITICAL: Also set target.tolerance on the prescription so HOLDING
                    // phase allows metric to drop from physio target back toward romMin
                    // without immediately failing. Without this, a physio target of 135°+
                    // calibrated offset makes hold impossible to sustain.
                    // holdSustainFloor = romAcceptableMin + offset (population-level floor)
                    // tolerance = target - holdSustainFloor (gap between trigger and floor)
                    const holdSustainFloor = isAbduction
                      ? (effectiveTarget ?? 70) + offset - 20  // abduction: 20° tolerance below target
                      : (romMin ?? 110) + offset;              // flexion: population floor
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
              if (id.includes("flexion")) {
                if (id.includes("right")) return f.rightArmElevationDeg;
                if (id.includes("left")) return f.leftArmElevationDeg;
                return f.bilateralArmElevationDeg;
              }
              if (id.includes("abduction")) {
                if (id.includes("right")) return f.rightShoulderAbductionDeg;
                if (id.includes("left")) return f.leftShoulderAbductionDeg;
                return f.bilateralShoulderAbductionDeg;
              }
              return null;
            })();

            // Spike threshold: 40° per frame for abduction (wrist-based metric
            // is smoother than elbow-based), 50° for flexion and others.
            const SPIKE_THRESHOLD_DEG = activePrescription.id.includes("abduction") ? 40 : 50;
            if (
              rawMetricThisFrame !== null &&
              prevMetricValueRef.current !== null &&
              Math.abs(rawMetricThisFrame - prevMetricValueRef.current) > SPIKE_THRESHOLD_DEG
            ) {
              // Clamp the spiked field back to previous value so the interpreter
              // sees a stable reading — do not update prevMetricValueRef this frame
              const id = activePrescription.id;
              const prev = prevMetricValueRef.current;
              if (id.includes("flexion")) {
                if (id.includes("right")) smoothedFeatures.rightArmElevationDeg = prev;
                else if (id.includes("left")) smoothedFeatures.leftArmElevationDeg = prev;
                else {
                  smoothedFeatures.bilateralArmElevationDeg = prev;
                  smoothedFeatures.rightArmElevationDeg = prev;
                  smoothedFeatures.leftArmElevationDeg = prev;
                }
              } else if (id.includes("abduction")) {
                if (id.includes("right")) smoothedFeatures.rightShoulderAbductionDeg = prev;
                else if (id.includes("left")) smoothedFeatures.leftShoulderAbductionDeg = prev;
                else {
                  smoothedFeatures.bilateralShoulderAbductionDeg = prev;
                  smoothedFeatures.rightShoulderAbductionDeg = prev;
                  smoothedFeatures.leftShoulderAbductionDeg = prev;
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
              // Reset peak metric tracker for this new rep
              peakMetricThisRepRef.current = null;
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

            // Hold ended — capture duration then reset entry time
            if (prevPhase === "holding" && currentPhase !== "holding") {
              lastHoldDurationMsRef.current = holdEnteredAtMsRef.current !== null
                ? nowMs - holdEnteredAtMsRef.current
                : null;
              holdEnteredAtMsRef.current = null;
            }

            // Track peak metric during lifting and holding phases
            if (currentPhase === "lifting" || currentPhase === "holding") {
              const metricNow = output.activeMetricValue;
              if (metricNow !== null && metricNow > (peakMetricThisRepRef.current ?? 0)) {
                peakMetricThisRepRef.current = metricNow;
              }
            }

            // Rep just completed
            if (output.repState.justCompletedRep) {
              console.log(
                `[REP COMPLETE] rep=${output.repState.repCount}` +
                ` | metric=${output.activeMetricValue?.toFixed(1) ?? "?"}°` +
                ` | peak=${peakMetricThisRepRef.current?.toFixed(1) ?? "?"}°` +
                ` | holdDuration=${lastHoldDurationMsRef.current ?? "?"}ms` +
                ` | finishThreshold=${activePrescription.finishThreshold.toFixed(1)}°` +
                ` | targetThreshold=${activePrescription.targetThreshold.toFixed(1)}°` +
                ` | startThreshold=${activePrescription.startThreshold.toFixed(1)}°` +
                ` | calib_baseline=${calibrationBaselineRef.current.toFixed(1)}°`
              );
              coachingCallbacks.onRepCompleted(nowMs, peakMetricThisRepRef.current, lastHoldDurationMsRef.current);
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
              // Shoulder flexion — forward raise (unchanged)
              if (id === "right-arm-raise" || id === "shoulder_flexion_right")
                return f.rightArmElevationDeg;
              if (id === "left-arm-raise" || id === "shoulder_flexion_left")
                return f.leftArmElevationDeg;
              if (id === "both-arm-raise" || id === "shoulder_flexion_bilateral")
                return f.bilateralArmElevationDeg;
              // Shoulder abduction — lateral raise (new metric)
              if (id === "shoulder_abduction_right") return f.rightShoulderAbductionDeg;
              if (id === "shoulder_abduction_left") return f.leftShoulderAbductionDeg;
              if (id === "shoulder_abduction_bilateral") return f.bilateralShoulderAbductionDeg;
              // Knee extension
              if (id === "knee_extension_right") return f.rightElbowAngleDeg;
              if (id === "knee_extension_left") return f.leftElbowAngleDeg;
              if (id === "knee_extension_bilateral") return f.bilateralArmElevationDeg;
              // Sit to stand
              if (id === "sit-to-stand" || id === "sit_to_stand")
                return f.hipHeightNormalized != null ? f.hipHeightNormalized * 100 : null;
              return null;
            })();

            // ------------------------------------------------
            // ABDUCTION MEASUREMENT DEBUG (fires every 30 frames)
            // Logs raw landmark positions and derived metrics to
            // diagnose 2D projection accuracy for lateral arm raise.
            // Remove once abduction metric is validated.
            // ------------------------------------------------
            if (activePrescription.id.includes("abduction") && normalized.personDetected) {
              debugFrameCountRef.current += 1;
              if (debugFrameCountRef.current % 30 === 0) {
                const lms = normalized.landmarks as Record<string, {x:number;y:number;score?:number}|undefined>;
                const ls = lms["left_shoulder"];
                const rs = lms["right_shoulder"];
                const lw = lms["left_wrist"];
                const rw = lms["right_wrist"];

                const rWristRise = rs && rw ? Math.round((rs.y - rw.y) * 1000) / 10 : null;
                const lWristRise = ls && lw ? Math.round((ls.y - lw.y) * 1000) / 10 : null;
                const rWristSpread = rs && rw ? Math.round(Math.abs(rw.x - rs.x) * 1000) / 10 : null;
                const lWristSpread = ls && lw ? Math.round(Math.abs(lw.x - ls.x) * 1000) / 10 : null;

                console.log(
                  `[ABDUCTION DEBUG] frame=${debugFrameCountRef.current} phase=${currentPhase}` +
                  ` | NEW: abdDeg(R)=${smoothedFeatures.rightShoulderAbductionDeg?.toFixed(1) ?? "null"}°` +
                  ` abdDeg(L)=${smoothedFeatures.leftShoulderAbductionDeg?.toFixed(1) ?? "null"}°` +
                  ` bilateral=${smoothedFeatures.bilateralShoulderAbductionDeg?.toFixed(1) ?? "null"}°` +
                  ` | OLD: elevDeg(R)=${smoothedFeatures.rightArmElevationDeg?.toFixed(1) ?? "null"}°` +
                  ` elevDeg(L)=${smoothedFeatures.leftArmElevationDeg?.toFixed(1) ?? "null"}°` +
                  ` | wristRise(R)=${rWristRise ?? "null"}% wristRise(L)=${lWristRise ?? "null"}%` +
                  ` | wristSpread(R)=${rWristSpread ?? "null"}% wristSpread(L)=${lWristSpread ?? "null"}%` +
                  ` | targetThresh=${activePrescription.targetThreshold.toFixed(1)}° startThresh=${activePrescription.startThreshold.toFixed(1)}°`
                );
              }
            }

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
            if (currentPhase === "ready") {
              framingCallbacks.evaluateFraming(
                normalized,
                smoothedFeatures,
                activePrescription,
                nowMs
              );
            }

            // ------------------------------------------------
            // PREREQUISITE GATE (ready phase only)
            // evaluateFraming ran above so prerequisiteResult
            // is always current before we read it here.
            // Only gates interpretMovement — everything else
            // (framing panel, observation panel) still runs.
            // ------------------------------------------------
            if (currentPhase === "ready") {
              const prereq = framingCallbacks.getPrerequisiteResult();
              if (!prereq.allMet && prereq.failures.length > 0) {
                const failure = prereq.failures[0];

                // Reset state machine if failure type changed
                if (prereqLastFailureId.current !== failure.id) {
                  prereqVoiceStateRef.current   = "unsaid";
                  prereqVoiceSpokenAtMs.current = null;
                  prereqLastFailureId.current   = failure.id;
                }

                const speakOnce = (text: string) => {
                  if (typeof window === "undefined" || !window.speechSynthesis) return;
                  if (window.speechSynthesis.speaking) return; // don't cut over coaching intro
                  window.setTimeout(() => {
                    const utt = new SpeechSynthesisUtterance(text);
                    utt.rate = 0.92; utt.pitch = 1.0; utt.volume = 1.0;
                    const voices = window.speechSynthesis.getVoices();
                    const pref = voices.find(v => v.lang.startsWith("en") && (
                      v.name.includes("Natural") || v.name.includes("Neural") ||
                      v.name.includes("Premium") || v.name.includes("Samantha") ||
                      v.name.includes("Karen")   || v.name.includes("Daniel")
                    ));
                    if (pref) utt.voice = pref;
                    window.speechSynthesis.speak(utt);
                  }, 150);
                };

                const vs = prereqVoiceStateRef.current;
                const spokenAt = prereqVoiceSpokenAtMs.current;

                if (vs === "unsaid") {
                  speakOnce(failure.patientMessage);
                  prereqVoiceStateRef.current   = "spoken_initial";
                  prereqVoiceSpokenAtMs.current = nowMs;
                  console.log(`[PREREQ GATE] initial | id=${failure.id} | ${failure.clinicalNote}`);
                } else if (vs === "spoken_initial" && spokenAt !== null && nowMs - spokenAt >= PREREQ_RETRY_DELAY_MS) {
                  prereqVoiceStateRef.current = "waiting";
                } else if (vs === "waiting") {
                  const retry = buildPrereqRetryMessage(failure.id);
                  speakOnce(retry);
                  prereqVoiceStateRef.current   = "spoken_retry";
                  prereqVoiceSpokenAtMs.current = nowMs;
                  console.log(`[PREREQ GATE] retry | id=${failure.id} | "${retry}"`);
                } else if (vs === "spoken_retry" && spokenAt !== null && nowMs - spokenAt >= PREREQ_RETRY_DELAY_MS) {
                  prereqVoiceStateRef.current = "exhausted";
                  console.log(`[PREREQ GATE] exhausted | id=${failure.id} | visual only`);
                }
                // "exhausted" — panel shows message, no more speech

                // Block interpretMovement this frame only
                // Jump to readiness/observation panel below
                const readiness = readinessEvaluator(normalized, smoothedFeatures, activePrescription);
                setLiveObservation({
                  visibilityLines: buildVisibilityLines(normalized, readiness.message, readiness.ready),
                  movementLines: buildMovementLines(activePrescription, currentPhase, smoothedFeatures, 0, null, "prerequisites_not_met", null)
                });
                if (trackingActiveRef.current) rafRef.current = window.requestAnimationFrame(loop);
                return;
              }

              // Prerequisites just cleared — reset for next exercise
              if (prereqLastFailureId.current !== null) {
                prereqVoiceStateRef.current   = "unsaid";
                prereqVoiceSpokenAtMs.current = null;
                prereqLastFailureId.current   = null;
              }
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
