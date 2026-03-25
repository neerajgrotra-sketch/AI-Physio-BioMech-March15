import type { ExercisePrescription } from "@/lib/types/exercise";
import type { BuilderFormValues } from "@/lib/prescriptions/builderTypes";

// ============================================================
// DEFAULT FRAMING DECLARATION BUILDER
// ============================================================
// Generates a sensible default framing declaration for
// prescriptions created via the exercise builder UI.
//
// The defaults are conservative — they ensure the system
// always has a valid framing declaration, even for custom
// exercises. Clinicians can refine these later.
// ============================================================

function buildDefaultFraming(
  values: BuilderFormValues
): ExercisePrescription["framing"] {
  const isUpperBody =
    values.category === "upper_body" ||
    values.side === "left" ||
    values.side === "right" ||
    values.side === "both";

  const isTransfer = values.category === "transfer";
  const isBilateral = values.side === "both";

  // Determine critical landmarks based on exercise type
  const criticalLandmarks: string[] = isTransfer
    ? ["left_hip", "right_hip", "left_knee", "right_knee"]
    : values.side === "right"
    ? ["right_shoulder", "right_elbow", "right_wrist"]
    : values.side === "left"
    ? ["left_shoulder", "left_elbow", "left_wrist"]
    : ["right_shoulder", "left_shoulder", "right_wrist", "left_wrist"];

  const supportingLandmarks: string[] = isTransfer
    ? ["left_shoulder", "right_shoulder", "nose"]
    : isBilateral
    ? ["right_elbow", "left_elbow", "nose"]
    : values.side === "right"
    ? ["left_shoulder", "nose", "right_hip"]
    : ["right_shoulder", "nose", "left_hip"];

  const requiredCoverage = isTransfer
    ? ("full_body" as const)
    : ("upper_body" as const);

  const peakMovementZone = isTransfer
    ? ("standing_full" as const)
    : ("shoulder_height" as const);

  const requiredStartPosture = isTransfer
    ? ("seated" as const)
    : ("either" as const);

  return {
    intent: `Measure ${values.name} movement. ${values.description}`,

    landmarks: {
      critical: criticalLandmarks,
      supporting: supportingLandmarks,
      reference: []
    },

    confidenceThresholds: {
      critical: 0.5,
      supporting: 0.35
    },

    requiredCoverage,
    peakMovementZone,
    requiredStartPosture,
    bilateralSymmetryRequired: isBilateral,

    angleGuidance:
      isTransfer
        ? "Camera must be positioned to see the full body. Aim for chest height or lower."
        : "Frontal view preferred. Ensure the relevant arm and shoulder are clearly visible.",

    measurementRisk:
      isTransfer
        ? "Without hip and knee visibility, standing position cannot be detected."
        : `Without clear visibility of the ${values.side === "both" ? "arm" : values.side + " arm"} landmarks, movement cannot be measured accurately.`
  };
}

// ============================================================
// BUILD PRESCRIPTION FROM FORM
// ============================================================

export function buildPrescriptionFromForm(
  values: BuilderFormValues
): ExercisePrescription {
  return {
    id: values.id,
    name: values.name,
    category: values.category,
    template: values.template,
    runtimeStatus: "active",
    side: values.side,
    posture: values.posture,
    description: values.description,

    repTarget: values.repTarget,

    startThreshold: values.startThreshold,
    targetThreshold: values.targetThreshold,
    finishThreshold: values.finishThreshold,

    target: {
      metric: values.targetMetric,
      label: values.targetLabel,
      targetValue: values.targetThreshold,
      tolerance: values.targetTolerance
    },

    hold: {
      required: values.holdRequired,
      durationMs: values.holdDurationMs
    },

    tempo: {
      label: values.tempoLabel
    },

    qualityLimits: {
      maxTorsoLeanDeg: values.maxTorsoLeanDeg,
      maxShoulderTiltDeg: values.maxShoulderTiltDeg,
      maxOppositeArmElevationDeg:
        values.side === "left" || values.side === "right"
          ? values.maxOppositeArmElevationDeg
          : undefined
    },

    coaching: {
      intro: values.cueIntro,
      lift: values.cueLift,
      hold: values.cueHold,
      lower: values.cueLower,
      success: values.cueSuccess,
      failedHeight: values.cueFailedHeight,
      failedHold: values.cueFailedHold,
      failedBalance: values.cueFailedBalance,
      failedIsolation: values.cueFailedIsolation || undefined,
      failedBilateralParticipation:
        values.cueFailedBilateralParticipation || undefined,
      liveIsolationCue: values.cueLiveIsolation || undefined,
      liveBilateralCue: values.cueLiveBilateral || undefined
    },

    // Framing declaration — auto-generated from form values.
    // Clinicians can refine these in a future builder update.
    framing: buildDefaultFraming(values)
  };
}
