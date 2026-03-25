// ============================================================
// lib/framing/framingTypes.ts
// ============================================================
// Type definitions for the framing intelligence layer.
//
// These types are shared between:
// - FramingMonitor (deterministic, fast, runs every 2s)
// - FramingEvaluator (AI-powered, runs on trigger)
// - SessionRunner (reads framing state for UI and gating)
// ============================================================

// ============================================================
// FRAMING SEVERITY
// ============================================================
// ok       — all critical and supporting landmarks visible,
//            coverage adequate, posture correct.
//            Exercise runs normally.
//
// warning  — supporting landmarks weak or coverage marginal.
//            Exercise continues. Warning shown in banner.
//            AI evaluation triggered after 3s persistence.
//
// critical — one or more critical landmarks lost for > 1500ms.
//            Exercise pauses between reps only.
//            Fallback instruction fires immediately.
//            AI evaluation triggered immediately.
// ============================================================

export type FramingSeverity = "ok" | "warning" | "critical";

// ============================================================
// FRAMING STATUS
// ============================================================
// Produced by FramingMonitor every 2 seconds.
// This is the fast, deterministic output — no AI involved.
// It drives:
// - Whether to trigger an AI framing evaluation
// - Whether to pause the exercise between reps
// - Which fallback instruction to show if AI times out
// ============================================================

export type FramingStatus = {
  // Overall severity level
  severity: FramingSeverity;

  // Whether framing is adequate for valid measurement
  adequate: boolean;

  // Critical landmarks currently below confidence threshold
  // These are the landmarks that will cause measurement failure
  criticalLandmarksLost: string[];

  // Supporting landmarks currently below confidence threshold
  // These degrade quality but do not stop measurement
  supportingLandmarksWeak: string[];

  // Whether the required body coverage is in frame
  coverageAdequate: boolean;

  // Whether patient posture matches exercise requirement
  postureCorrect: boolean;

  // Whether bilateral symmetry is adequate (for bilateral exercises)
  bilateralSymmetryOk: boolean;

  // How long the current severity level has persisted in ms
  // Used to decide when to escalate from warning to critical
  severityDurationMs: number;

  // Timestamp of when current severity level started
  severityStartedAtMs: number;

  // Whether this status should trigger an AI framing evaluation
  triggerAiEvaluation: boolean;

  // Reason for triggering AI evaluation (for prompt context)
  triggerReason: FramingTriggerReason | null;

  // Deterministic fallback instruction — fires immediately
  // if AI is not available or times out
  fallbackInstruction: string | null;

  // Whether the exercise should be paused
  // Only true when severity is critical AND duration > 1500ms
  // Exercise only pauses between reps, never mid-movement
  shouldPauseExercise: boolean;

  // Timestamp of this status evaluation
  evaluatedAtMs: number;
};

// ============================================================
// FRAMING TRIGGER REASON
// ============================================================
// Why an AI framing evaluation was triggered.
// Passed into the AI prompt for context.
// ============================================================

export type FramingTriggerReason =
  | "pre_exercise_check"      // Before exercise starts
  | "severity_changed"        // ok→warning or warning→critical
  | "severity_persisting"     // Warning persisting > 3s without correction
  | "critical_landmark_lost"  // Critical landmark suddenly lost
  | "posture_changed"         // Patient posture changed unexpectedly
  | "bilateral_asymmetry"     // Bilateral symmetry degraded
  | "coverage_degraded";      // Body coverage dropped below required

// ============================================================
// FRAMING EVALUATION RESULT
// ============================================================
// Produced by the AI framing evaluator (FramingEvaluator).
// Returned asynchronously — may arrive 1-3s after trigger.
// If it arrives after phase has changed, it is discarded.
// ============================================================

export type FramingEvaluationResult = {
  // Whether framing is adequate for valid measurement
  adequate: boolean;

  // Whether measurement will be clinically valid
  willMeasurementBeValid: boolean;

  // AI-assessed severity (may differ from deterministic)
  severity: FramingSeverity;

  // Instruction to display/speak to the patient
  // Null if framing is adequate
  patientInstruction: string | null;

  // Clinical note for internal logging
  // Not shown to patient
  clinicalNote: string;

  // Which exercise this evaluation was for
  exerciseId: string;

  // Timestamp of when AI result was received
  receivedAtMs: number;

  // Whether this result is still relevant
  // (set to false if phase changed since trigger)
  isStillRelevant: boolean;
};

// ============================================================
// FRAMING PANEL STATE
// ============================================================
// What SessionRunner reads to render the framing UI panel.
// Single source of truth for the framing banner.
// ============================================================

export type FramingPanelState = {
  // Visual tone of the banner
  tone: "good" | "warning" | "critical";

  // Message to display to the patient
  message: string;

  // Whether the framing is waiting for an AI evaluation
  evaluating: boolean;

  // Whether the exercise is currently paused for framing
  exercisePaused: boolean;

  // The current severity for programmatic use
  severity: FramingSeverity;
};

// ============================================================
// LANDMARK CONFIDENCE REPORT
// ============================================================
// Snapshot of current landmark visibility.
// Built from the current PoseFrame inside FramingMonitor.
// ============================================================

export type LandmarkConfidenceReport = {
  // All detected landmarks with their confidence scores
  landmarks: Record<string, number>;

  // Whether a person is detected at all
  personDetected: boolean;

  // Estimated body coverage in frame
  estimatedCoverage: "head_only" | "upper_body" | "torso_and_hips" | "full_body" | "none";

  // Estimated posture
  estimatedPosture: "seated" | "standing" | "unknown";

  // Whether the patient appears centered
  isCentered: boolean;

  // Timestamp
  capturedAtMs: number;
};
