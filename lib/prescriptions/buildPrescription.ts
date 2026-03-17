import type { ExercisePrescription } from "@/lib/types/exercise";
import type { BuilderFormValues } from "@/lib/prescriptions/builderTypes";

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
    }
  };
}
