// ============================================================
// lib/framing/useFramingIntelligence.ts
// ============================================================
// React hook that wires FramingMonitor and FramingEvaluator
// together for use in SessionRunner.
//
// SessionRunner calls this hook and reads:
// - framingPanelState  → what to show in the framing banner
// - shouldPauseExercise → whether to pause between reps
// - evaluateFraming()  → call this every frame from the loop
// - forceCheck()       → call this before each exercise starts
// ============================================================

import { useRef, useState, useCallback } from "react";

import { FramingMonitor } from "@/lib/framing/framingMonitor";
import { FramingEvaluator } from "@/lib/framing/framingEvaluator";
import type { PatientProfile } from "@/lib/framing/framingEvaluator";
import type { FramingPanelState } from "@/lib/framing/framingTypes";
import type { PoseFrame } from "@/lib/types/pose";
import type { MovementFeatures } from "@/lib/types/movement";
import type { ExercisePrescription } from "@/lib/types/exercise";

// ============================================================
// PANEL STATE BUILDER
// ============================================================
// Translates internal FramingStatus + AI result into the
// simple FramingPanelState that SessionRunner renders.
// ============================================================

function buildPanelState(
  message: string,
  severity: "ok" | "warning" | "critical",
  evaluating: boolean,
  exercisePaused: boolean
): FramingPanelState {
  return {
    tone: severity === "ok" ? "good" : severity === "warning" ? "warning" : "critical",
    message,
    evaluating,
    exercisePaused,
    severity
  };
}

// ============================================================
// HOOK
// ============================================================

export function useFramingIntelligence(patientProfile: PatientProfile) {
  // Stable class instances — do not recreate on render
  const monitorRef = useRef(new FramingMonitor(2000));
  const evaluatorRef = useRef(new FramingEvaluator());

  // UI state — what SessionRunner renders
  const [framingPanelState, setFramingPanelState] =
    useState<FramingPanelState>({
      tone: "warning",
      message: "Camera is off.",
      evaluating: false,
      exercisePaused: false,
      severity: "ok"
    });

  const [shouldPauseExercise, setShouldPauseExercise] = useState(false);

  // ----------------------------------------------------------
  // RESET
  // Call when session starts, exercise changes, or session ends
  // ----------------------------------------------------------

  const reset = useCallback((message = "Position yourself in view.") => {
    monitorRef.current.reset();
    evaluatorRef.current.cancel();
    setShouldPauseExercise(false);
    setFramingPanelState(
      buildPanelState(message, "warning", false, false)
    );
  }, []);

  // ----------------------------------------------------------
  // EVALUATE FRAMING
  // Call from the inference loop every frame.
  // FramingMonitor internally throttles to every 2 seconds.
  // ----------------------------------------------------------

  const evaluateFraming = useCallback(
    (
      frame: PoseFrame | null,
      features: MovementFeatures,
      prescription: ExercisePrescription,
      nowMs: number
    ) => {
      const status = monitorRef.current.evaluate(
        frame,
        features,
        prescription,
        nowMs
      );

      // No new evaluation this frame — interval not elapsed
      if (!status) return;

      // Update pause state
      setShouldPauseExercise(status.shouldPauseExercise);

      // If framing is adequate, show good state
      if (status.adequate) {
        setFramingPanelState(
          buildPanelState("Framing looks good.", "ok", false, false)
        );
        return;
      }

      // Show fallback immediately while AI evaluates
      if (status.fallbackInstruction) {
        setFramingPanelState(
          buildPanelState(
            status.fallbackInstruction,
            status.severity,
            status.triggerAiEvaluation,
            status.shouldPauseExercise
          )
        );
      }

      // Trigger AI evaluation if needed
      if (status.triggerAiEvaluation) {
        // Build confidence report for the evaluator
        const confidenceReport = {
          landmarks: Object.fromEntries(
            [
              ...prescription.framing.landmarks.critical,
              ...prescription.framing.landmarks.supporting,
              ...prescription.framing.landmarks.reference
            ].map((name) => {
              const landmarks = (frame as any)?.landmarks;
              const point = landmarks?.[name];
              const score =
                typeof point?.score === "number" ? point.score : 0;
              return [name, score];
            })
          ),
          personDetected: Boolean((frame as any)?.personDetected),
          estimatedCoverage: "upper_body" as const,
          estimatedPosture: features.isSeated
            ? ("seated" as const)
            : features.isStanding
            ? ("standing" as const)
            : ("unknown" as const),
          isCentered: true,
          capturedAtMs: nowMs
        };

        evaluatorRef.current.evaluate(
          prescription,
          status,
          confidenceReport,
          patientProfile,
          // onResult — AI responded in time
          (result) => {
            if (!result.isStillRelevant) return;

            setFramingPanelState(
              buildPanelState(
                result.patientInstruction ??
                  "Framing looks good.",
                result.severity,
                false,
                status.shouldPauseExercise
              )
            );
          },
          // onFallback — AI timed out, use deterministic message
          (fallbackMessage) => {
            setFramingPanelState(
              buildPanelState(
                fallbackMessage,
                status.severity,
                false,
                status.shouldPauseExercise
              )
            );
          }
        );
      }
    },
    [patientProfile]
  );

  // ----------------------------------------------------------
  // FORCE PRE-EXERCISE CHECK
  // Call before each exercise starts.
  // Returns the deterministic status immediately and also
  // triggers an AI evaluation in the background.
  // ----------------------------------------------------------

  const forcePreExerciseCheck = useCallback(
    (
      frame: PoseFrame | null,
      features: MovementFeatures,
      prescription: ExercisePrescription,
      nowMs: number
    ) => {
      const status = monitorRef.current.forcePreExerciseCheck(
        frame,
        features,
        prescription,
        nowMs
      );

      setShouldPauseExercise(status.shouldPauseExercise);

      // Show fallback immediately
      const initialMessage =
        status.adequate
          ? "Framing looks good."
          : status.fallbackInstruction ??
            "Adjust your position so I can see you clearly.";

      setFramingPanelState(
        buildPanelState(
          initialMessage,
          status.severity,
          true, // AI evaluation is about to be triggered
          status.shouldPauseExercise
        )
      );

      // Always trigger AI on pre-exercise check
      const confidenceReport = {
        landmarks: Object.fromEntries(
          [
            ...prescription.framing.landmarks.critical,
            ...prescription.framing.landmarks.supporting
          ].map((name) => {
            const landmarks = (frame as any)?.landmarks;
            const point = landmarks?.[name];
            const score =
              typeof point?.score === "number" ? point.score : 0;
            return [name, score];
          })
        ),
        personDetected: Boolean((frame as any)?.personDetected),
        estimatedCoverage: "upper_body" as const,
        estimatedPosture: features.isSeated
          ? ("seated" as const)
          : features.isStanding
          ? ("standing" as const)
          : ("unknown" as const),
        isCentered: true,
        capturedAtMs: nowMs
      };

      evaluatorRef.current.evaluate(
        prescription,
        status,
        confidenceReport,
        patientProfile,
        (result) => {
          if (!result.isStillRelevant) return;
          setFramingPanelState(
            buildPanelState(
              result.patientInstruction ?? "Framing looks good.",
              result.severity,
              false,
              status.shouldPauseExercise
            )
          );
        },
        (fallbackMessage) => {
          setFramingPanelState(
            buildPanelState(
              fallbackMessage,
              status.severity,
              false,
              status.shouldPauseExercise
            )
          );
        }
      );
    },
    [patientProfile]
  );

  return {
    framingPanelState,
    shouldPauseExercise,
    evaluateFraming,
    forcePreExerciseCheck,
    reset
  };
}
