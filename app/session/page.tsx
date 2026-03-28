"use client";

// app/session/page.tsx
// Session runner entry point — reads ?prescription=UUID from URL
// Fetches prescription from Supabase, maps to ExercisePrescription format,
// then renders SessionRunner with the queue pre-loaded.
//
// Falls back to the full exercise library if no prescription param is given.

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import SessionRunner from "@/components/session/SessionRunner";
import type { ExercisePrescription } from "@/lib/types/exercise";

// ─── Mapping from Supabase template name → ExercisePrescription ──────────────
// The biomechanics engine works with specific prescription shapes.
// We map by the template's `name` field (slug), then apply overrides.

function buildPrescription(
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
    failedHeight: (coachingStrings.correction_height as string) ?? "Lift a little higher.",
    failedHold: (coachingStrings.correction_hold as string) ?? "Hold for the full duration.",
    failedBalance: (coachingStrings.correction_balance as string) ?? "Keep your posture steady.",
    failedIsolation: (coachingStrings.correction_isolation as string) ?? undefined,
  };

  // Map template name to the correct biomechanics configuration
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
        description: "Lift your right arm to shoulder height, hold, then lower slowly.",
        repTarget: repOverride,
        startThreshold: 25,
        targetThreshold: 70,
        finishThreshold: 30,
        target: { metric: "rightArmElevationDeg", label: "shoulder height", targetValue: 70, tolerance: 10 },
        hold,
        tempo: { label: "slow and controlled" },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15, maxOppositeArmElevationDeg: 35 },
        coaching,
        framing: {
          intent: "Measure right arm elevation arc from resting position to shoulder height.",
          landmarks: { critical: ["right_shoulder", "right_elbow", "right_wrist"], supporting: ["left_shoulder", "nose", "right_hip"], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "upper_body",
          peakMovementZone: "shoulder_height",
          requiredStartPosture: "either",
          bilateralSymmetryRequired: false,
          angleGuidance: "Frontal view preferred. Ensure the right arm and shoulder are clearly visible.",
          measurementRisk: "Without clear visibility of right arm landmarks, elevation cannot be measured accurately.",
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
        description: "Lift your left arm to shoulder height, hold, then lower slowly.",
        repTarget: repOverride,
        startThreshold: 25,
        targetThreshold: 70,
        finishThreshold: 30,
        target: { metric: "leftArmElevationDeg", label: "shoulder height", targetValue: 70, tolerance: 10 },
        hold,
        tempo: { label: "slow and controlled" },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15, maxOppositeArmElevationDeg: 35 },
        coaching,
        framing: {
          intent: "Measure left arm elevation arc from resting position to shoulder height.",
          landmarks: { critical: ["left_shoulder", "left_elbow", "left_wrist"], supporting: ["right_shoulder", "nose", "left_hip"], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "upper_body",
          peakMovementZone: "shoulder_height",
          requiredStartPosture: "either",
          bilateralSymmetryRequired: false,
          angleGuidance: "Frontal view preferred. Ensure the left arm and shoulder are clearly visible.",
          measurementRisk: "Without clear visibility of left arm landmarks, elevation cannot be measured accurately.",
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
        description: "Lift both arms to shoulder height, hold, then lower slowly.",
        repTarget: repOverride,
        startThreshold: 25,
        targetThreshold: 70,
        finishThreshold: 30,
        target: { metric: "bilateralArmElevationDeg", label: "shoulder height", targetValue: 70, tolerance: 10 },
        hold,
        tempo: { label: "slow and controlled" },
        qualityLimits: { maxTorsoLeanDeg: 18, maxShoulderTiltDeg: 15 },
        coaching,
        framing: {
          intent: "Measure bilateral arm elevation simultaneously. Both arms must be equally visible.",
          landmarks: { critical: ["left_shoulder", "left_elbow", "left_wrist", "right_shoulder", "right_elbow", "right_wrist"], supporting: ["nose", "left_hip", "right_hip"], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "upper_body",
          peakMovementZone: "shoulder_height",
          requiredStartPosture: "either",
          bilateralSymmetryRequired: true,
          angleGuidance: "Frontal view required. Patient must be centred with both arms fully visible.",
          measurementRisk: "Without bilateral landmark visibility, asymmetry cannot be detected.",
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
        description: "Rise to standing, hold, then sit back down with control.",
        repTarget: repOverride,
        startThreshold: 100,
        targetThreshold: 170,
        finishThreshold: 120,
        target: { metric: "kneeToHipExtensionScore", label: "full standing", targetValue: 170, tolerance: 10 },
        hold: { required: holdMsOverride > 0, durationMs: holdMsOverride || 1000 },
tempo: { label: "slow and controlled" },
coaching,
        framing: {
          intent: "Detect hip transition from seated to full standing. Hip and knee landmarks must be visible throughout.",
          landmarks: { critical: ["left_hip", "right_hip", "left_knee", "right_knee"], supporting: ["left_shoulder", "right_shoulder", "left_ankle", "right_ankle"], reference: [] },
          confidenceThresholds: { critical: 0.5, supporting: 0.35 },
          requiredCoverage: "full_body",
          peakMovementZone: "standing_full",
          requiredStartPosture: "seated",
          bilateralSymmetryRequired: false,
          angleGuidance: "Side or frontal view. Full body must be visible from head to feet.",
          measurementRisk: "Without hip and knee visibility, standing position cannot be confirmed.",
        },
      };

    default:
      // Unknown template — skip with a warning
      console.warn(`Unknown exercise template: "${templateName}" — skipping.`);
      return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SupabasePrescriptionExercise {
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

// ─── Loading screen ───────────────────────────────────────────────────────────

function LoadingScreen({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <div style={{ fontSize: 32 }}>⚡</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#e6edf3" }}>AI Physio</div>
      <div style={{ fontSize: 14, color: "#7d8590" }}>{message}</div>
    </div>
  );
}

function ErrorScreen({ message, prescriptionId }: { message: string; prescriptionId: string | null }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
      padding: 32,
    }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#e6edf3" }}>Session Not Found</div>
      <div style={{ fontSize: 14, color: "#7d8590", maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>{message}</div>
      {prescriptionId && (
        <div style={{ fontSize: 11, color: "#484f58", fontFamily: "monospace" }}>
          Prescription ID: {prescriptionId}
        </div>
      )}
      <a href="/admin" style={{
        marginTop: 8, padding: "8px 20px",
        background: "#388bfd", color: "#fff", borderRadius: 6,
        textDecoration: "none", fontSize: 13, fontWeight: 500,
      }}>
        ← Back to Admin
      </a>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const searchParams = useSearchParams();
  const prescriptionId = searchParams.get("prescription");

  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-param">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [prescriptions, setPrescriptions] = useState<ExercisePrescription[]>([]);

  const supabase = getSupabaseClient();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // No prescription param — just launch with default library
    if (!prescriptionId) {
      setStatus("no-param");
      return;
    }

    async function load() {
      try {
        // Fetch the prescription + its exercises from Supabase
        const { data, error } = await supabase
          .from("session_prescriptions")
          .select(`
            id,
            title,
            objective,
            prescription_exercises (
              sequence_order,
              reps_override,
              hold_ms_override,
              exercise_templates (
                name,
                display_name,
                default_reps,
                default_hold_ms,
                coaching_strings
              )
            )
          `)
          .eq("id", prescriptionId)
          .single();

        if (error || !data) {
          setErrorMessage(
            error?.message ?? "Prescription not found. It may have been deleted."
          );
          setStatus("error");
          return;
        }

        setSessionTitle(data.title);

        // Sort exercises by sequence order
        const exercises: SupabasePrescriptionExercise[] = (
          (data.prescription_exercises as unknown as SupabasePrescriptionExercise[]) ?? []
        ).sort((a, b) => a.sequence_order - b.sequence_order);

        if (exercises.length === 0) {
          setErrorMessage("This session has no exercises assigned. Add exercises in the Session Builder.");
          setStatus("error");
          return;
        }

        // Map each exercise to an ExercisePrescription
        const mapped: ExercisePrescription[] = [];
        for (const ex of exercises) {
          const tmpl = ex.exercise_templates;
          if (!tmpl) continue;

          const reps = ex.reps_override ?? tmpl.default_reps;
          const holdMs = ex.hold_ms_override ?? tmpl.default_hold_ms;
          const prescription = buildPrescription(tmpl.name, reps, holdMs, tmpl.coaching_strings);

          if (prescription) {
            // Apply per-session coaching strings from Supabase
            mapped.push(prescription);
          }
        }

        if (mapped.length === 0) {
          setErrorMessage(
            "None of the exercises in this session could be loaded. " +
            "Make sure the exercise template names match: right-arm-raise, left-arm-raise, both-arm-raise, sit-to-stand."
          );
          setStatus("error");
          return;
        }

        setPrescriptions(mapped);
        setStatus("ready");
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : "Unknown error loading session.");
        setStatus("error");
      }
    }

    load();
  }, [prescriptionId, supabase]);

  // No prescription param — render SessionRunner with its default behaviour
  if (status === "no-param") {
    return <SessionRunner />;
  }

  if (status === "loading") {
    return <LoadingScreen message="Loading session…" />;
  }

  if (status === "error") {
    return <ErrorScreen message={errorMessage} prescriptionId={prescriptionId} />;
  }

  // Prescription loaded — render SessionRunner with injected queue
  return (
    <SessionRunner
      prescriptionQueue={prescriptions}
      sessionTitle={sessionTitle}
    />
  );
}
