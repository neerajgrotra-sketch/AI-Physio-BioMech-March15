// ============================================================
// lib/framing/framingMonitor.ts
// ============================================================
// Deterministic framing monitor.
//
// Runs every 2 seconds inside the inference loop.
// Fast, synchronous — never calls the AI.
// Reads landmark confidence against the exercise's framing
// declaration and produces a FramingStatus.
//
// Drives:
// - Whether to trigger an AI framing evaluation
// - Whether to pause the exercise between reps
// - Which fallback instruction to show
// ============================================================

import type { PoseFrame } from "@/lib/types/pose";
import type { MovementFeatures } from "@/lib/types/movement";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type {
  FramingStatus,
  FramingSeverity,
  FramingTriggerReason,
  LandmarkConfidenceReport
} from "@/lib/framing/framingTypes";

// ============================================================
// CONSTANTS
// ============================================================

// How long critical severity must persist before pausing
const CRITICAL_PAUSE_THRESHOLD_MS = 1500;

// How long warning must persist before triggering AI evaluation
const WARNING_AI_TRIGGER_MS = 3000;

// Bilateral confidence asymmetry that counts as a problem
// e.g. right wrist at 0.8, left wrist at 0.2 = asymmetric
const BILATERAL_ASYMMETRY_THRESHOLD = 0.3;

// ============================================================
// LANDMARK CONFIDENCE EXTRACTION
// ============================================================

function getLandmarkConfidence(
  frame: PoseFrame | null,
  landmarkName: string
): number {
  if (!frame) return 0;
  const landmarks = (frame as any)?.landmarks;
  if (!landmarks) return 0;

  const point = landmarks[landmarkName];
  if (!point || typeof point.x !== "number") return 0;

  return typeof point.score === "number" ? point.score : 1;
}

function buildLandmarkConfidenceReport(
  frame: PoseFrame | null,
  features: MovementFeatures
): LandmarkConfidenceReport {
  const personDetected = Boolean((frame as any)?.personDetected);
  const landmarks: Record<string, number> = {};

  if (!frame || !personDetected) {
    return {
      landmarks,
      personDetected: false,
      estimatedCoverage: "none",
      estimatedPosture: "unknown",
      isCentered: false,
      capturedAtMs: Date.now()
    };
  }

  const allLandmarkNames = [
    "nose",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle"
  ];

  for (const name of allLandmarkNames) {
    landmarks[name] = getLandmarkConfidence(frame, name);
  }

  // Estimate coverage based on which landmarks are visible
  const hasHead = landmarks["nose"] > 0.2;
  const hasShoulders =
    landmarks["left_shoulder"] > 0.2 && landmarks["right_shoulder"] > 0.2;
  const hasHips =
    landmarks["left_hip"] > 0.2 && landmarks["right_hip"] > 0.2;
  const hasKnees =
    landmarks["left_knee"] > 0.2 || landmarks["right_knee"] > 0.2;

  let estimatedCoverage: LandmarkConfidenceReport["estimatedCoverage"] = "none";

  if (hasHead && hasShoulders && hasHips && hasKnees) {
    estimatedCoverage = "full_body";
  } else if (hasHead && hasShoulders && hasHips) {
    estimatedCoverage = "torso_and_hips";
  } else if (hasHead && hasShoulders) {
    estimatedCoverage = "upper_body";
  } else if (hasHead) {
    estimatedCoverage = "head_only";
  }

  // Estimate posture from features
  let estimatedPosture: LandmarkConfidenceReport["estimatedPosture"] = "unknown";
  if (features.isStanding) estimatedPosture = "standing";
  else if (features.isSeated) estimatedPosture = "seated";

  // Check centering via nose position
  const nosePoint = (frame as any)?.landmarks?.["nose"];
  const isCentered =
    nosePoint &&
    typeof nosePoint.x === "number" &&
    nosePoint.x >= 0.18 &&
    nosePoint.x <= 0.82;

  return {
    landmarks,
    personDetected,
    estimatedCoverage,
    estimatedPosture,
    isCentered: Boolean(isCentered),
    capturedAtMs: Date.now()
  };
}

// ============================================================
// LANDMARK TIER EVALUATION
// ============================================================

function evaluateLandmarkTiers(
  report: LandmarkConfidenceReport,
  prescription: ExercisePrescription
): {
  criticalLandmarksLost: string[];
  supportingLandmarksWeak: string[];
} {
  const { landmarks: framing } = prescription.framing;
  const { confidenceThresholds } = prescription.framing;
  const { landmarks: confidence } = report;

  const criticalLandmarksLost = framing.critical.filter(
    (name) => (confidence[name] ?? 0) < confidenceThresholds.critical
  );

  const supportingLandmarksWeak = framing.supporting.filter(
    (name) => (confidence[name] ?? 0) < confidenceThresholds.supporting
  );

  return { criticalLandmarksLost, supportingLandmarksWeak };
}

// ============================================================
// COVERAGE CHECK
// ============================================================

function evaluateCoverage(
  report: LandmarkConfidenceReport,
  prescription: ExercisePrescription
): boolean {
  const required = prescription.framing.requiredCoverage;
  const current = report.estimatedCoverage;

  const coverageRank: Record<string, number> = {
    none: 0,
    head_only: 1,
    upper_body: 2,
    torso_and_hips: 3,
    full_body: 4
  };

  return (coverageRank[current] ?? 0) >= (coverageRank[required] ?? 0);
}

// ============================================================
// POSTURE CHECK
// ============================================================

function evaluatePosture(
  report: LandmarkConfidenceReport,
  prescription: ExercisePrescription
): boolean {
  const required = prescription.framing.requiredStartPosture;

  if (required === "either") return true;

  if (required === "seated") return report.estimatedPosture === "seated";
  if (required === "standing") return report.estimatedPosture === "standing";

  return true;
}

// ============================================================
// BILATERAL SYMMETRY CHECK
// ============================================================

function evaluateBilateralSymmetry(
  report: LandmarkConfidenceReport,
  prescription: ExercisePrescription
): boolean {
  if (!prescription.framing.bilateralSymmetryRequired) return true;

  const { landmarks: confidence } = report;

  // Check each critical landmark pair for symmetry
  const pairs: Array<[string, string]> = [
    ["left_shoulder", "right_shoulder"],
    ["left_elbow", "right_elbow"],
    ["left_wrist", "right_wrist"]
  ];

  for (const [left, right] of pairs) {
    const leftConf = confidence[left] ?? 0;
    const rightConf = confidence[right] ?? 0;

    // Only check pairs where at least one side is visible
    if (leftConf < 0.1 && rightConf < 0.1) continue;

    const asymmetry = Math.abs(leftConf - rightConf);
    if (asymmetry > BILATERAL_ASYMMETRY_THRESHOLD) {
      return false;
    }
  }

  return true;
}

// ============================================================
// SEVERITY CALCULATION
// ============================================================

function calculateSeverity(
  criticalLandmarksLost: string[],
  supportingLandmarksWeak: string[],
  coverageAdequate: boolean,
  postureCorrect: boolean,
  bilateralSymmetryOk: boolean
): FramingSeverity {
  // Critical: any critical landmark lost
  if (criticalLandmarksLost.length > 0) {
    return "critical";
  }

  // Warning: multiple supporting landmarks weak,
  // coverage inadequate, posture wrong, or bilateral asymmetry
  if (
    supportingLandmarksWeak.length > 1 ||
    !coverageAdequate ||
    !postureCorrect ||
    !bilateralSymmetryOk
  ) {
    return "warning";
  }

  // Single weak supporting landmark is tolerated
  return "ok";
}

// ============================================================
// TRIGGER REASON DETECTION
// ============================================================

function detectTriggerReason(
  current: FramingStatus | null,
  newSeverity: FramingSeverity,
  criticalLandmarksLost: string[],
  postureCorrect: boolean,
  bilateralSymmetryOk: boolean,
  coverageAdequate: boolean,
  isPreExercise: boolean
): FramingTriggerReason | null {
  if (isPreExercise) return "pre_exercise_check";

  // Severity just changed
  if (current && current.severity !== newSeverity) {
    return "severity_changed";
  }

  // Critical landmark suddenly lost
  if (
    criticalLandmarksLost.length > 0 &&
    (!current || current.criticalLandmarksLost.length === 0)
  ) {
    return "critical_landmark_lost";
  }

  // Posture changed
  if (current && current.postureCorrect !== postureCorrect) {
    return "posture_changed";
  }

  // Bilateral asymmetry appeared
  if (current && current.bilateralSymmetryOk && !bilateralSymmetryOk) {
    return "bilateral_asymmetry";
  }

  // Coverage dropped
  if (current && current.coverageAdequate && !coverageAdequate) {
    return "coverage_degraded";
  }

  // Warning persisting without correction
  if (
    newSeverity === "warning" &&
    current &&
    current.severity === "warning" &&
    current.severityDurationMs >= WARNING_AI_TRIGGER_MS
  ) {
    return "severity_persisting";
  }

  return null;
}

// ============================================================
// FALLBACK INSTRUCTION BUILDER
// ============================================================
// Deterministic instructions used when AI is unavailable.
// Derived from the framing declaration's measurementRisk
// and the specific landmarks that are lost.
// ============================================================

function buildFallbackInstruction(
  prescription: ExercisePrescription,
  criticalLandmarksLost: string[],
  supportingLandmarksWeak: string[],
  coverageAdequate: boolean,
  postureCorrect: boolean,
  bilateralSymmetryOk: boolean
): string | null {
  // No issue — no instruction needed
  if (
    criticalLandmarksLost.length === 0 &&
    coverageAdequate &&
    postureCorrect &&
    bilateralSymmetryOk
  ) {
    return null;
  }

  // Posture mismatch — most important to fix first
  if (!postureCorrect) {
    const required = prescription.framing.requiredStartPosture;
    if (required === "seated") {
      return "Please sit down before we begin this exercise.";
    }
    if (required === "standing") {
      return "Please stand upright before we begin.";
    }
  }

  // Coverage inadequate
  if (!coverageAdequate) {
    const required = prescription.framing.requiredCoverage;
    if (required === "full_body") {
      return "Step back so your full body is visible — I need to see from head to feet.";
    }
    return "Step back so I can see your full upper body.";
  }

  // Bilateral symmetry off
  if (!bilateralSymmetryOk) {
    return "Center yourself so both arms are equally visible to the camera.";
  }

  // Critical landmarks lost — be specific about which ones
  if (criticalLandmarksLost.some(l => l.includes("hip") || l.includes("knee"))) {
    return "I need to see your hips and knees — move the camera back or position it lower.";
  }

  // Bilateral exercises: if BOTH sides have missing landmarks, give a centering cue
  // not a single-side message — avoids misleading "I can't see your right arm" on bilateral
  const bilateralRequired = prescription.framing.bilateralSymmetryRequired;
  const rightArmLost = criticalLandmarksLost.some(l => l.includes("right_wrist") || l.includes("right_elbow") || l === "right_shoulder");
  const leftArmLost  = criticalLandmarksLost.some(l => l.includes("left_wrist")  || l.includes("left_elbow")  || l === "left_shoulder");

  if (bilateralRequired && (rightArmLost || leftArmLost)) {
    // Both arms need to be visible for bilateral exercises
    if (rightArmLost && leftArmLost) {
      return "Step back so both arms are fully visible — I need to see your full upper body.";
    }
    if (rightArmLost) {
      return "Move slightly left so your right arm is fully in frame.";
    }
    if (leftArmLost) {
      return "Move slightly right so your left arm is fully in frame.";
    }
  }

  // Unilateral exercises: side-specific messages
  if (!bilateralRequired) {
    if (criticalLandmarksLost.some(l => l.includes("right_wrist") || l.includes("right_elbow"))) {
      return "I can't see your right arm clearly — make sure your full right arm is in frame.";
    }
    if (criticalLandmarksLost.some(l => l.includes("left_wrist") || l.includes("left_elbow"))) {
      return "I can't see your left arm clearly — make sure your full left arm is in frame.";
    }
  }

  if (criticalLandmarksLost.some(l => l.includes("shoulder"))) {
    return "I need to see your shoulders clearly — step back a little and face the camera.";
  }

  // Generic fallback
  return "Adjust your position so I can see you clearly.";
}

// ============================================================
// FRAMING MONITOR CLASS
// ============================================================

export class FramingMonitor {
  private lastStatus: FramingStatus | null = null;
  private lastEvaluationMs = 0;
  private readonly evaluationIntervalMs: number;

  constructor(evaluationIntervalMs = 2000) {
    this.evaluationIntervalMs = evaluationIntervalMs;
  }

  // ----------------------------------------------------------
  // RESET
  // Called when exercise changes or session resets
  // ----------------------------------------------------------

  reset(): void {
    this.lastStatus = null;
    this.lastEvaluationMs = 0;
  }

  // ----------------------------------------------------------
  // EVALUATE
  // Called from the inference loop.
  // Returns null if the evaluation interval has not elapsed,
  // unless forceEvaluate is true (used for pre-exercise check).
  // ----------------------------------------------------------

  evaluate(
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number,
    forceEvaluate = false
  ): FramingStatus | null {
    // Throttle evaluations to every 2 seconds
    if (
      !forceEvaluate &&
      nowMs - this.lastEvaluationMs < this.evaluationIntervalMs
    ) {
      return null;
    }

    this.lastEvaluationMs = nowMs;

    const report = buildLandmarkConfidenceReport(frame, features);

    // If no person detected, return critical immediately
    if (!report.personDetected) {
      const status: FramingStatus = {
        severity: "critical",
        adequate: false,
        criticalLandmarksLost: prescription.framing.landmarks.critical,
        supportingLandmarksWeak: [],
        coverageAdequate: false,
        postureCorrect: false,
        bilateralSymmetryOk: false,
        severityDurationMs:
          this.lastStatus?.severity === "critical"
            ? nowMs - this.lastStatus.severityStartedAtMs
            : 0,
        severityStartedAtMs:
          this.lastStatus?.severity === "critical"
            ? this.lastStatus.severityStartedAtMs
            : nowMs,
        triggerAiEvaluation: false,
        triggerReason: null,
        fallbackInstruction: "Step into view so I can see you properly.",
        shouldPauseExercise: false,
        evaluatedAtMs: nowMs
      };

      this.lastStatus = status;
      return status;
    }

    // Evaluate each check
    const { criticalLandmarksLost, supportingLandmarksWeak } =
      evaluateLandmarkTiers(report, prescription);

    const coverageAdequate = evaluateCoverage(report, prescription);
    const postureCorrect = evaluatePosture(report, prescription);
    const bilateralSymmetryOk = evaluateBilateralSymmetry(
      report,
      prescription
    );

    // Calculate severity
    const newSeverity = calculateSeverity(
      criticalLandmarksLost,
      supportingLandmarksWeak,
      coverageAdequate,
      postureCorrect,
      bilateralSymmetryOk
    );

    // Track how long this severity has persisted
    const severityStartedAtMs =
      this.lastStatus?.severity === newSeverity
        ? this.lastStatus.severityStartedAtMs
        : nowMs;

    const severityDurationMs = nowMs - severityStartedAtMs;

    // Decide whether this is a pre-exercise check
    const isPreExercise = this.lastStatus === null;

    // Detect trigger reason
    const triggerReason = detectTriggerReason(
      this.lastStatus,
      newSeverity,
      criticalLandmarksLost,
      postureCorrect,
      bilateralSymmetryOk,
      coverageAdequate,
      isPreExercise
    );

    // Trigger AI evaluation if there is a reason
    const triggerAiEvaluation = triggerReason !== null;

    // Build fallback instruction
    const fallbackInstruction = buildFallbackInstruction(
      prescription,
      criticalLandmarksLost,
      supportingLandmarksWeak,
      coverageAdequate,
      postureCorrect,
      bilateralSymmetryOk
    );

    // Determine whether to pause exercise
    // Only pause if critical severity has persisted > threshold
    const shouldPauseExercise =
      newSeverity === "critical" &&
      severityDurationMs >= CRITICAL_PAUSE_THRESHOLD_MS;

    const adequate =
      newSeverity === "ok" &&
      criticalLandmarksLost.length === 0 &&
      coverageAdequate;

    const status: FramingStatus = {
      severity: newSeverity,
      adequate,
      criticalLandmarksLost,
      supportingLandmarksWeak,
      coverageAdequate,
      postureCorrect,
      bilateralSymmetryOk,
      severityDurationMs,
      severityStartedAtMs,
      triggerAiEvaluation,
      triggerReason,
      fallbackInstruction,
      shouldPauseExercise,
      evaluatedAtMs: nowMs
    };

    this.lastStatus = status;
    return status;
  }

  // ----------------------------------------------------------
  // GET LAST STATUS
  // Used by SessionRunner to read current framing state
  // without triggering a new evaluation
  // ----------------------------------------------------------

  getLastStatus(): FramingStatus | null {
    return this.lastStatus;
  }

  // ----------------------------------------------------------
  // FORCE PRE-EXERCISE CHECK
  // Called before an exercise starts to get an immediate
  // framing evaluation regardless of interval
  // ----------------------------------------------------------

  forcePreExerciseCheck(
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number
  ): FramingStatus {
    this.reset();
    return this.evaluate(frame, features, prescription, nowMs, true) as FramingStatus;
  }
}
