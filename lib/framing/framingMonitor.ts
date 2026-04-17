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
// Also exports evaluatePrerequisites() — a hard gate that
// runs before interpretMovement() every frame. It checks
// the minimum landmark visibility required for the exercise's
// metric computation to succeed. If prerequisites fail the
// inference loop stays in "ready" and speaks the failure
// message. The state machine never receives a frame it
// cannot handle.
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
const BILATERAL_ASYMMETRY_THRESHOLD = 0.3;

// Minimum confidence score for a landmark to count as "visible"
// for prerequisite purposes. Slightly lower than critical threshold
// to avoid false negatives on partially occluded landmarks.
const PREREQ_CONFIDENCE_MIN = 0.15;

// ============================================================
// PREREQUISITE RESULT TYPE
// ============================================================

export type PrerequisiteFailure = {
  id: string;
  patientMessage: string;   // Spoken aloud to patient
  clinicalNote: string;     // Debug panel only
};

export type PrerequisiteResult = {
  allMet: boolean;
  failures: PrerequisiteFailure[];
};

// ============================================================
// PREREQUISITE EVALUATOR
// ============================================================
// Pure function — no side effects, no state.
// Called every frame from the inference loop BEFORE
// interpretMovement(). Returns immediately.
//
// Five checks in priority order:
//   1. Person detected
//   2. Required coverage (derives from prescription.requiredCoverage)
//   3. Start posture matches requirement (seated/standing/either)
//   4. Exercise-side landmarks visible (right/left/both/center)
//   5. Bilateral symmetry if required
//
// Only the first failure is spoken — avoids overwhelming the
// patient with multiple instructions at once.
// ============================================================

export function evaluatePrerequisites(
  prescription: ExercisePrescription,
  frame: PoseFrame | null,
  features: MovementFeatures
): PrerequisiteResult {
  const failures: PrerequisiteFailure[] = [];

  // ── Check 1: Person detected ──────────────────────────────
  if (!frame?.personDetected) {
    failures.push({
      id: "no_person",
      patientMessage: "Please step into the camera view.",
      clinicalNote: "No person detected in frame."
    });
    return { allMet: false, failures };
  }

  const lm = (frame as any)?.landmarks ?? {};
  const conf = (name: string): number => {
    const point = lm[name];
    if (!point || typeof point.x !== "number") return 0;
    return typeof point.score === "number" ? point.score : 1;
  };
  const visible = (name: string) => conf(name) >= PREREQ_CONFIDENCE_MIN;

  // ── Check 2: Required coverage ────────────────────────────
  // Derived from prescription.requiredCoverage (from DB).
  // Each level checks the landmarks that the metric computation
  // actually depends on — not just cosmetic visibility.

  const requiredCoverage = prescription.framing?.requiredCoverage as
    | "upper_body"
    | "torso_and_hips"
    | "full_body"
    | undefined;

  if (requiredCoverage === "full_body") {
    // sit_to_stand: inferPosture needs hip+knee+ankle bilateral
    const needsFullBody = [
      "left_hip", "right_hip",
      "left_knee", "right_knee",
      "left_ankle", "right_ankle"
    ];
    const missing = needsFullBody.filter(n => !visible(n));
    if (missing.length > 0) {
      const hasAnklesMissing = missing.some(n => n.includes("ankle"));
      failures.push({
        id: "coverage_full_body",
        patientMessage: hasAnklesMissing
          ? "Please step back so I can see your full body from head to feet."
          : "I need to see your hips and knees — please step back a little.",
        clinicalNote: `Full body required. Missing: ${missing.join(", ")}.`
      });
    }
  } else if (requiredCoverage === "torso_and_hips") {
    // knee_extension: needs hips and knees visible (seated)
    const needsTorso = ["left_hip", "right_hip", "left_knee", "right_knee"];
    const missing = needsTorso.filter(n => !visible(n));
    if (missing.length > 0) {
      failures.push({
        id: "coverage_torso_hips",
        patientMessage: "I need to see your hips and knees — please move the camera back or position it lower.",
        clinicalNote: `Torso+hips required. Missing: ${missing.join(", ")}.`
      });
    }
  } else {
    // upper_body (default): needs shoulders on the relevant side(s)
    const shouldersOk =
      visible("left_shoulder") || visible("right_shoulder");
    if (!shouldersOk) {
      failures.push({
        id: "coverage_upper_body",
        patientMessage: "Please step back so I can see your shoulders and arms clearly.",
        clinicalNote: "Upper body required but no shoulders visible."
      });
    }
  }

  // ── Check 3: Start posture ────────────────────────────────
  // Only gate on posture if we already have coverage — posture
  // detection depends on the same landmarks as coverage.
  if (failures.length === 0) {
    const requiredPosture = prescription.framing?.requiredStartPosture ?? "either";

    if (requiredPosture === "seated" && !features.isSeated) {
      // Only fail if posture is positively detected as standing
      // (not "unknown") — avoids blocking when landmarks are marginal
      if (features.isStanding) {
        failures.push({
          id: "posture_must_be_seated",
          patientMessage: "Please sit down before we begin this exercise.",
          clinicalNote: `Exercise requires seated start. Detected: standing.`
        });
      } else if (features.posture === "unknown" && requiredCoverage === "full_body") {
        // Full body coverage confirmed but posture still unknown —
        // landmarks are visible but angles are indeterminate.
        // Patient is likely mid-transition or partially occluded.
        failures.push({
          id: "posture_indeterminate",
          patientMessage: "Please sit fully in your chair so I can confirm your starting position.",
          clinicalNote: "Full body coverage ok but posture indeterminate — patient may be mid-transition."
        });
      }
    }

    if (requiredPosture === "standing" && !features.isStanding) {
      if (features.isSeated) {
        failures.push({
          id: "posture_must_be_standing",
          patientMessage: "Please stand upright before we begin.",
          clinicalNote: `Exercise requires standing start. Detected: seated.`
        });
      }
    }
  }

  // ── Check 4: Side-specific landmark visibility ────────────
  if (failures.length === 0) {
    const side = prescription.side;

    if (side === "right") {
      if (!visible("right_shoulder") || !visible("right_elbow") || !visible("right_wrist")) {
        failures.push({
          id: "side_landmarks_right",
          patientMessage: "I need to see your full right arm — make sure your shoulder, elbow and wrist are in frame.",
          clinicalNote: "Right side landmarks insufficient for measurement."
        });
      }
    } else if (side === "left") {
      if (!visible("left_shoulder") || !visible("left_elbow") || !visible("left_wrist")) {
        failures.push({
          id: "side_landmarks_left",
          patientMessage: "I need to see your full left arm — make sure your shoulder, elbow and wrist are in frame.",
          clinicalNote: "Left side landmarks insufficient for measurement."
        });
      }
    } else if (side === "both") {
      const rightOk = visible("right_shoulder") && visible("right_wrist");
      const leftOk  = visible("left_shoulder")  && visible("left_wrist");
      if (!rightOk || !leftOk) {
        if (!rightOk && !leftOk) {
          failures.push({
            id: "side_landmarks_bilateral",
            patientMessage: "Please step back so both arms are fully visible.",
            clinicalNote: "Both sides have insufficient landmark visibility."
          });
        } else if (!rightOk) {
          failures.push({
            id: "side_landmarks_bilateral_right",
            patientMessage: "Move slightly left so your right arm is fully in frame.",
            clinicalNote: "Right side landmarks insufficient for bilateral measurement."
          });
        } else {
          failures.push({
            id: "side_landmarks_bilateral_left",
            patientMessage: "Move slightly right so your left arm is fully in frame.",
            clinicalNote: "Left side landmarks insufficient for bilateral measurement."
          });
        }
      }
    }
    // "center" (sit_to_stand) — covered by coverage check above
  }

  // ── Check 5: Bilateral symmetry ───────────────────────────
  if (failures.length === 0 && prescription.framing?.bilateralSymmetryRequired) {
    const pairs: Array<[string, string]> = [
      ["left_shoulder", "right_shoulder"],
      ["left_wrist",    "right_wrist"]
    ];
    for (const [left, right] of pairs) {
      const lc = conf(left);
      const rc = conf(right);
      if (lc < 0.1 && rc < 0.1) continue;
      if (Math.abs(lc - rc) > BILATERAL_ASYMMETRY_THRESHOLD) {
        failures.push({
          id: "bilateral_asymmetry",
          patientMessage: "Centre yourself so both arms are equally visible to the camera.",
          clinicalNote: `Bilateral asymmetry: ${left}=${lc.toFixed(2)} ${right}=${rc.toFixed(2)}.`
        });
        break;
      }
    }
  }

  return {
    allMet: failures.length === 0,
    failures
  };
}

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

  // Estimate coverage based on which landmarks are visible.
  // full_body now correctly requires ankles — not just knees.
  // This matches what inferPosture() actually needs.
  const hasHead      = landmarks["nose"] > 0.2;
  const hasShoulders = landmarks["left_shoulder"] > 0.2 && landmarks["right_shoulder"] > 0.2;
  const hasHips      = landmarks["left_hip"]  > 0.2 && landmarks["right_hip"]  > 0.2;
  const hasKnees     = landmarks["left_knee"] > 0.2 || landmarks["right_knee"] > 0.2;
  const hasAnkles    = landmarks["left_ankle"] > 0.2 || landmarks["right_ankle"] > 0.2;

  let estimatedCoverage: LandmarkConfidenceReport["estimatedCoverage"] = "none";

  if (hasHead && hasShoulders && hasHips && hasKnees && hasAnkles) {
    estimatedCoverage = "full_body";
  } else if (hasHead && hasShoulders && hasHips && hasKnees) {
    estimatedCoverage = "torso_and_hips";
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

  const pairs: Array<[string, string]> = [
    ["left_shoulder", "right_shoulder"],
    ["left_elbow", "right_elbow"],
    ["left_wrist", "right_wrist"]
  ];

  for (const [left, right] of pairs) {
    const leftConf = confidence[left] ?? 0;
    const rightConf = confidence[right] ?? 0;

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
  if (criticalLandmarksLost.length > 0) {
    return "critical";
  }

  if (
    supportingLandmarksWeak.length > 1 ||
    !coverageAdequate ||
    !postureCorrect ||
    !bilateralSymmetryOk
  ) {
    return "warning";
  }

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

  if (current && current.severity !== newSeverity) {
    return "severity_changed";
  }

  if (
    criticalLandmarksLost.length > 0 &&
    (!current || current.criticalLandmarksLost.length === 0)
  ) {
    return "critical_landmark_lost";
  }

  if (current && current.postureCorrect !== postureCorrect) {
    return "posture_changed";
  }

  if (current && current.bilateralSymmetryOk && !bilateralSymmetryOk) {
    return "bilateral_asymmetry";
  }

  if (current && current.coverageAdequate && !coverageAdequate) {
    return "coverage_degraded";
  }

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

function buildFallbackInstruction(
  prescription: ExercisePrescription,
  criticalLandmarksLost: string[],
  supportingLandmarksWeak: string[],
  coverageAdequate: boolean,
  postureCorrect: boolean,
  bilateralSymmetryOk: boolean
): string | null {
  if (
    criticalLandmarksLost.length === 0 &&
    coverageAdequate &&
    postureCorrect &&
    bilateralSymmetryOk
  ) {
    return null;
  }

  if (!postureCorrect) {
    const required = prescription.framing.requiredStartPosture;
    if (required === "seated") {
      return "Please sit down before we begin this exercise.";
    }
    if (required === "standing") {
      return "Please stand upright before we begin.";
    }
  }

  if (!coverageAdequate) {
    const required = prescription.framing.requiredCoverage;
    if (required === "full_body") {
      return "Step back so your full body is visible — I need to see from head to feet.";
    }
    if (required === "torso_and_hips") {
      return "Step back so I can see your hips and knees clearly.";
    }
    return "Step back so I can see your full upper body.";
  }

  if (!bilateralSymmetryOk) {
    return "Centre yourself so both arms are equally visible to the camera.";
  }

  if (criticalLandmarksLost.some(l => l.includes("hip") || l.includes("knee"))) {
    return "I need to see your hips and knees — move the camera back or position it lower.";
  }

  const bilateralRequired = prescription.framing.bilateralSymmetryRequired;
  const rightArmLost = criticalLandmarksLost.some(l => l.includes("right_wrist") || l.includes("right_elbow") || l === "right_shoulder");
  const leftArmLost  = criticalLandmarksLost.some(l => l.includes("left_wrist")  || l.includes("left_elbow")  || l === "left_shoulder");

  if (bilateralRequired && (rightArmLost || leftArmLost)) {
    if (rightArmLost && leftArmLost) {
      return "Step back so both arms are fully visible — I need to see your full upper body.";
    }
    if (rightArmLost) return "Move slightly left so your right arm is fully in frame.";
    if (leftArmLost)  return "Move slightly right so your left arm is fully in frame.";
  }

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

  reset(): void {
    this.lastStatus = null;
    this.lastEvaluationMs = 0;
  }

  evaluate(
    frame: PoseFrame | null,
    features: MovementFeatures,
    prescription: ExercisePrescription,
    nowMs: number,
    forceEvaluate = false
  ): FramingStatus | null {
    if (
      !forceEvaluate &&
      nowMs - this.lastEvaluationMs < this.evaluationIntervalMs
    ) {
      return null;
    }

    this.lastEvaluationMs = nowMs;

    const report = buildLandmarkConfidenceReport(frame, features);

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

    const { criticalLandmarksLost, supportingLandmarksWeak } =
      evaluateLandmarkTiers(report, prescription);

    const coverageAdequate = evaluateCoverage(report, prescription);
    const postureCorrect = evaluatePosture(report, prescription);
    const bilateralSymmetryOk = evaluateBilateralSymmetry(report, prescription);

    const newSeverity = calculateSeverity(
      criticalLandmarksLost,
      supportingLandmarksWeak,
      coverageAdequate,
      postureCorrect,
      bilateralSymmetryOk
    );

    const severityStartedAtMs =
      this.lastStatus?.severity === newSeverity
        ? this.lastStatus.severityStartedAtMs
        : nowMs;

    const severityDurationMs = nowMs - severityStartedAtMs;

    const isPreExercise = this.lastStatus === null;

    const triggerReason = detectTriggerReason(
      this.lastStatus,
      newSeverity,
      criticalLandmarksLost,
      postureCorrect,
      bilateralSymmetryOk,
      coverageAdequate,
      isPreExercise
    );

    const triggerAiEvaluation = triggerReason !== null;

    const fallbackInstruction = buildFallbackInstruction(
      prescription,
      criticalLandmarksLost,
      supportingLandmarksWeak,
      coverageAdequate,
      postureCorrect,
      bilateralSymmetryOk
    );

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

  getLastStatus(): FramingStatus | null {
    return this.lastStatus;
  }

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
