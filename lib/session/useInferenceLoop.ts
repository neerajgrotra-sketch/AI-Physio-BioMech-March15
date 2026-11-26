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
import { extractMovementFeatures, emptyMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { FlexionViewEstimator } from "@/lib/biomechanics/flexionView";
import { applyWorld3DForm, arm3D, type Arm3D, type V3 } from "@/lib/biomechanics/world3d";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement, getEffectiveActiveMetricValue } from "@/lib/interpreter/movementInterpreter";
import { calibrationKindFor, calibrateThresholds, applyThresholds, FeatureSpikeFilter } from "@/lib/engine/calibration";

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RuntimeRepState } from "@/lib/engine/runtimeTypes";
import type { PatientProfile, ExerciseSessionContext } from "@/lib/patient/patientTypes";

// ============================================================
// EMPTY FEATURES FACTORY
// ============================================================

// One definition, shared with the feature extractor.
export const createEmptyFeatures = emptyMovementFeatures;

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
  getPrerequisiteResult: () => { allMet: boolean; failures: Array<{ id: string; patientMessage: string; clinicalNote: string; retryMessage?: string }> };
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
  const spikeFilterRef = useRef(new FeatureSpikeFilter());
  // Arm elevation facing the camera or side on (lib/biomechanics/flexionView.ts).
  const flexionViewRef = useRef(new FlexionViewEstimator());
  // EXPERIMENT: the arm read from BlazePose's own 3D estimate (keypoints3D),
  // logged next to the 2D method for comparison (lib/biomechanics/world3d.ts).
  const world3dRef = useRef<{ right: Arm3D | null; left: Arm3D | null }>({ right: null, left: null });
  // The latest features, for code that runs outside React renders (the ghost
  // loop): reading the `features` state there gave a copy frozen at start.
  const featuresRef = useRef<MovementFeatures | null>(null);
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
  const PREREQ_RETRY_DELAY_MS = 8000;

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
    spikeFilterRef.current.reset(); // reset spike filter on each exercise
    flexionViewRef.current.reset(); // the arm length is learned again per exercise
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
            const kp3 = (pose as { keypoints3D?: V3[] } | null)?.keypoints3D;
            world3dRef.current = { right: arm3D(kp3, "right"), left: arm3D(kp3, "left") };
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

            // ── Facing the camera or side on (lib/biomechanics/flexionView.ts) ──
            // Facing the camera, arm elevation comes from the elbow's height
            // and the patient's learned arm length instead of the 2D angle.
            if (normalized.personDetected) {
              flexionViewRef.current.apply(smoothedFeatures);
              // Form checks from BlazePose's 3D estimate where it has one
              // (lib/biomechanics/world3d.ts). The replay has no 3D input,
              // so the tests exercise the 2D form path.
              applyWorld3DForm(smoothedFeatures, world3dRef.current, flexionViewRef.current.currentView());
            }

            featuresRef.current = smoothedFeatures;
            setFeatures(smoothedFeatures);

            // ── Resting-baseline calibration (lib/engine/calibration.ts) ──
            // For arm exercises, sample the metric for the first few seconds
            // once the patient is in position (locked by the positioning
            // coach), not from the first frame they are seen: before that
            // they may still be walking in or sitting down. Then set start /
            // target / finish from the resting reading. Knees and
            // sit-to-stand use fixed thresholds.
            const activeMetric = activePrescription.target.metric;
            const positioned = framingCallbacks.getPrerequisiteResult().allMet;
            if (normalized.personDetected && positioned && !calibrationCompleteRef.current) {
              if (calibrationKindFor(activeMetric) === "none") {
                calibrationCompleteRef.current = true;
              } else {
                if (calibrationStartMsRef.current === null) {
                  calibrationStartMsRef.current = nowMs;
                }
                const sample = getEffectiveActiveMetricValue(smoothedFeatures, activePrescription);
                if (sample !== null) calibrationSamplesRef.current.push(sample);

                if (nowMs - calibrationStartMsRef.current >= calibrationWindowMs) {
                  calibrationCompleteRef.current = true;
                  const t = calibrateThresholds(calibrationSamplesRef.current, {
                    romAcceptableMin: (activePrescription as any).romAcceptableMin ?? null,
                    romTargetDegrees: (activePrescription as any).romTargetDegrees ?? null,
                  });
                  if (t) {
                    applyThresholds(activePrescription, t);
                    calibrationBaselineRef.current = t.baseline;
                    setCalibrationBaseline(t.baseline);
                    console.log(
                      `[CALIBRATION COMPLETE] ex=${activePrescription.id}` +
                      ` | baseline=${t.baseline.toFixed(1)}° | samples=${calibrationSamplesRef.current.length}` +
                      ` | start=${t.start.toFixed(1)}° | target=${t.target.toFixed(1)}°` +
                      ` | finish=${t.finish.toFixed(1)}° | tolerance=${t.tolerance.toFixed(1)}°`
                    );
                  }
                }
              }
            }

            // ── Spike filter (lib/engine/calibration.ts) ────────────────
            // Drops single-frame pose glitches on the fields this exercise
            // reads; a change that lasts 3 frames is accepted.
            spikeFilterRef.current.apply(smoothedFeatures, activeMetric);

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

            // Position gate (before the first rep): until the patient is
            // in position and has held still (lib/positioning), the rep
            // state machine does not move. The gate used to run AFTER this
            // update, so it never actually held anything back.
            const gateClosed =
              repStateRef.current.phase === "ready" &&
              repStateRef.current.repCount === 0 &&
              !framingCallbacks.getPrerequisiteResult().allMet;
            if (gateClosed) {
              output.repState = {
                ...repStateRef.current,
                justCompletedRep: false,
                justFailedRep: false,
                justCompletedHold: false,
                lastRepEvaluation: { outcome: "none", reason: null },
              };
            }

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
            // (A rep can also start straight from lowering, when the patient
            // raises again before resting fully.)
            if ((prevPhase === "ready" || prevPhase === "lowering") && currentPhase === "lifting") {
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
                ` | calib_baseline=${calibrationBaselineRef.current.toFixed(1)}°` +
                ` | view=${flexionViewRef.current.currentView() ?? "?"}`
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
            // PREREQUISITE GATE (before first rep only)
            // Hard gate: blocks ready→lifting until prerequisites
            // are met. Only applies when repCount === 0 — once
            // a session is underway, the patient has already
            // demonstrated adequate framing and the gate relaxes.
            // Between reps (repCount > 0) framing issues are
            // advisory only — shown visually, never blocking.
            // ------------------------------------------------
            if (currentPhase === "ready" && output.repState.repCount === 0) {
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
                  const retry = failure.retryMessage ?? buildPrereqRetryMessage(failure.id);
                  speakOnce(retry);
                  prereqVoiceStateRef.current   = "spoken_retry";
                  prereqVoiceSpokenAtMs.current = nowMs;
                  console.log(`[PREREQ GATE] retry | id=${failure.id} | "${retry}"`);
                } else if (vs === "spoken_retry" && spokenAt !== null && nowMs - spokenAt >= PREREQ_RETRY_DELAY_MS) {
                  // Keep guiding: repeat the short version every
                  // PREREQ_RETRY_DELAY_MS for as long as the problem lasts.
                  // (It used to go silent after two tries.)
                  prereqVoiceStateRef.current = "waiting";
                }

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
    /** Facing the camera or side on, as the arm measurement judges it (null until seen). */
    getFacingView: () => flexionViewRef.current.currentView(),
    /** EXPERIMENT: the arm from BlazePose keypoints3D (logged only). */
    getWorld3D: () => world3dRef.current,
    /** The latest features (use this outside renders, not `features`). */
    getFeatures: () => featuresRef.current,
    /** The learned upper-arm length in torso lengths (front-view flexion), or null. */
    getArmLength: (side: "right" | "left") => flexionViewRef.current.armLength(side),
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
