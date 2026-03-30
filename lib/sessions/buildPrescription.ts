// lib/session/buildPrescription.ts
// Shared prescription builder — used by both the server page (data fetch)
// and any client component that needs the same mapping logic.
//
// Maps a Supabase exercise_template name (slug) + per-session overrides
// to the ExercisePrescription shape that the biomechanics engine expects.

import type { ExercisePrescription } from "@/lib/types/exercise";

// ─── Raw Supabase shapes ──────────────────────────────────────────────────────

// New path: session_blocks → session_block_exercises (module 8+)
export interface SupabaseSessionBlock {
  id: string;
  sequence_order: number;
  rest_before_ms: number;
  title_override: string | null;
  session_block_exercises: {
    sequence_order: number;
    reps_override: number | null;
    hold_ms_override: number | null;
    exercise_templates: {
      name: string;
      display_name: string;
      default_reps: number;
      default_hold_ms: number;
      coaching_strings: Record<string, unknown>;
    } | null;
  }[];
}

// Backward-compat path: flat prescription_exercises (pre-module-8)
export interface SupabasePrescriptionExercise {
  sequence_order: number;
  reps_override: number | null;
  hold_ms_override: number | null;
  exercise_templates: {
    name: string;
    display_name: string;
    default_reps: number;
    default_hold_ms: number;
    coaching_strings: Record<string, unknown>;
  } | null;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildPrescription(
  templateName: string,
  repOverride: number,
  holdMsOverride: number,
  coachingStrings: Record<string, unknown>
): ExercisePrescription | null {
  const hold = {
    required: holdMsOverride > 0,
    durationMs: holdMsOverride,
  };

  const coaching = {
    intro: (coachingStrings.intro as string) ?? "Begin when ready.",
    lift: "Lift to the target position.",
    hold: Array.isArray(coachingStrings.hold)
      ? (coachingStrings.hold as string[])[0] ?? "Hold at the top."
      : (coachingStrings.hold as string) ?? "Hold at the top.",
    lower: (coachingStrings.lower as string) ?? "Lower slowly.",
    success: Array.isArray(coachingStrings.success_rotating)
      ? (coachingStrings.success_rotating as string[])[0] ?? "Good."
      : "Good.",
    failedHeight:
      (coachingStrings.correction_height as string) ?? "Lift a little higher.",
    failedHold:
      (coachingStrings.correction_hold as string) ??
      "Hold for the full duration.",
    failedBalance:
      (coachingStrings.correction_balance as string) ??
      "Keep your posture steady.",
    failedIsolation:
      (coachingStrings.correction_isolation as string) ?? undefined,
  };

  switch (templateName) {
    case "right-arm-raise":
      return {
        id: "right-arm-raise",
        name: "Right Arm Raise",
        category: "upper_body",
        template: "raise_hold_lower",
        runtimeStatus: "active",
        side: "right",
        posture: "either",
        description:
          "Lift your right arm to shoulder height, hold, then lower slowly.",
        repTarget: repOverride,
        startThreshold: 25,
        targetThreshold: 70,
        finishThreshold: 30,
        target: {
          metric: "rightArmElevationDeg",
          label: "shoulder height",
          targetValue: 70,
          tolerance: 10,
        },
        hold,
        tempo: { label: "slow and controlled" },
        qualityLimits: {
          maxTorsoLeanDeg: 18,
          maxShoulderTiltDeg: 15,
          maxOppositeArmElevationDeg: 35,
        },
        coaching,
        framing: {
          intent:
            "Measure right arm elevation arc from resting position to shoulder height.",
          landmarks: {
            critical: ["right_shoulder", "right_elbow", "right_wrist"],
            supporting: ["left_shoulder", "nose", "right_hip"],
            reference: [],
          },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "upper_body",
          peakMovementZone: "shoulder_height",
          requiredStartPosture: "either",
          bilateralSymmetryRequired: false,
          angleGuidance:
            "Frontal view preferred. Ensure the right arm and shoulder are clearly visible.",
          measurementRisk:
            "Without clear visibility of right arm landmarks, elevation cannot be measured accurately.",
        },
      };

    case "left-arm-raise":
      return {
        id: "left-arm-raise",
        name: "Left Arm Raise",
        category: "upper_body",
        template: "raise_hold_lower",
        runtimeStatus: "active",
        side: "left",
        posture: "either",
        description:
          "Lift your left arm to shoulder height, hold, then lower slowly.",
        repTarget: repOverride,
        startThreshold: 25,
        targetThreshold: 70,
        finishThreshold: 30,
        target: {
          metric: "leftArmElevationDeg",
          label: "shoulder height",
          targetValue: 70,
          tolerance: 10,
        },
        hold,
        tempo: { label: "slow and controlled" },
        qualityLimits: {
          maxTorsoLeanDeg: 18,
          maxShoulderTiltDeg: 15,
          maxOppositeArmElevationDeg: 35,
        },
        coaching,
        framing: {
          intent:
            "Measure left arm elevation arc from resting position to shoulder height.",
          landmarks: {
            critical: ["left_shoulder", "left_elbow", "left_wrist"],
            supporting: ["right_shoulder", "nose", "left_hip"],
            reference: [],
          },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "upper_body",
          peakMovementZone: "shoulder_height",
          requiredStartPosture: "either",
          bilateralSymmetryRequired: false,
          angleGuidance:
            "Frontal view preferred. Ensure the left arm and shoulder are clearly visible.",
          measurementRisk:
            "Without clear visibility of left arm landmarks, elevation cannot be measured accurately.",
        },
      };

    case "both-arm-raise":
      return {
        id: "both-arm-raise",
        name: "Both Arm Raise",
        category: "upper_body",
        template: "raise_hold_lower",
        runtimeStatus: "active",
        side: "both",
        posture: "either",
        description:
          "Lift both arms to shoulder height, hold, then lower slowly.",
        repTarget: repOverride,
        startThreshold: 25,
        targetThreshold: 70,
        finishThreshold: 30,
        target: {
          metric: "bilateralArmElevationDeg",
          label: "shoulder height",
          targetValue: 70,
          tolerance: 10,
        },
        hold,
        tempo: { label: "slow and controlled" },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15 },
        coaching,
        framing: {
          intent:
            "Measure bilateral arm elevation simultaneously. Both arms must be equally visible.",
          landmarks: {
            critical: [
              "left_shoulder",
              "left_elbow",
              "left_wrist",
              "right_shoulder",
              "right_elbow",
              "right_wrist",
            ],
            supporting: ["nose", "left_hip", "right_hip"],
            reference: [],
          },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "upper_body",
          peakMovementZone: "shoulder_height",
          requiredStartPosture: "either",
          bilateralSymmetryRequired: true,
          angleGuidance:
            "Frontal view required. Patient must be centred with both arms fully visible.",
          measurementRisk:
            "Without bilateral landmark visibility, asymmetry cannot be detected.",
        },
      };

    case "sit-to-stand":
      return {
        id: "sit-to-stand",
        name: "Sit to Stand",
        category: "transfer",
        template: "rise_hold_lower",
        runtimeStatus: "active",
        side: "center",
        posture: "seated",
        description:
          "Rise to standing, hold, then sit back down with control.",
        repTarget: repOverride,
        startThreshold: 100,
        targetThreshold: 170,
        finishThreshold: 120,
        target: {
          metric: "kneeToHipExtensionScore",
          label: "full standing",
          targetValue: 170,
          tolerance: 10,
        },
        hold: { required: holdMsOverride > 0, durationMs: holdMsOverride || 1000 },
        tempo: { label: "slow and controlled" },
        coaching,
        framing: {
          intent:
            "Detect hip transition from seated to full standing. Hip and knee landmarks must be visible throughout.",
          landmarks: {
            critical: [
              "left_hip",
              "right_hip",
              "left_knee",
              "right_knee",
            ],
            supporting: [
              "left_shoulder",
              "right_shoulder",
              "left_ankle",
              "right_ankle",
            ],
            reference: [],
          },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "full_body",
          peakMovementZone: "standing_full",
          requiredStartPosture: "seated",
          bilateralSymmetryRequired: false,
          angleGuidance:
            "Side or frontal view. Full body must be visible from head to feet.",
          measurementRisk:
            "Without hip and knee visibility, standing position cannot be confirmed.",
        },
      };

    default:
      console.warn(`Unknown exercise template: "${templateName}" — skipping.`);
      return null;
  }
}
