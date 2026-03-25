// ============================================================
// lib/framing/framingEvaluator.ts
// ============================================================
// AI-powered framing evaluator.
//
// Called by SessionRunner when FramingMonitor sets
// triggerAiEvaluation = true.
//
// This runs asynchronously — it never blocks the frame loop.
// If the API call takes longer than TIMEOUT_MS, the
// deterministic fallback from FramingStatus is used instead.
//
// The AI receives:
// - Exercise framing declaration (intent, measurement risk)
// - Current landmark confidence report
// - Patient profile
// - Trigger reason (why evaluation was requested)
//
// The AI returns:
// - Whether framing is adequate
// - A patient instruction (if needed)
// - A clinical note (for logging)
// ============================================================

import type { ExercisePrescription } from "@/lib/types/exercise";
import type {
  FramingStatus,
  FramingEvaluationResult,
  LandmarkConfidenceReport
} from "@/lib/framing/framingTypes";

// ============================================================
// PATIENT PROFILE
// ============================================================
// Passed to the AI so it can adapt its language appropriately.
// Populated by SessionRunner from session configuration.
// ============================================================

export type PatientProfile = {
  // Primary patient type — drives tone and language complexity
  type: "senior" | "post_surgery" | "chronic_pain" | "general_fitness";

  // How familiar is this patient with this exercise?
  exerciseFamiliarity: "first_time" | "some_experience" | "practiced";

  // Which session number is this?
  // AI uses this to calibrate how detailed instructions are
  sessionNumber: number;
};

export function createDefaultPatientProfile(): PatientProfile {
  return {
    type: "general_fitness",
    exerciseFamiliarity: "some_experience",
    sessionNumber: 1
  };
}

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildFramingPrompt(
  prescription: ExercisePrescription,
  framingStatus: FramingStatus,
  confidenceReport: LandmarkConfidenceReport,
  patientProfile: PatientProfile
): string {
  const { framing } = prescription;

  // Format landmark confidence scores for the prompt
  const criticalLandmarkLines = framing.landmarks.critical.map((name) => {
    const score = confidenceReport.landmarks[name] ?? 0;
    const status =
      score >= framing.confidenceThresholds.critical
        ? "✓ visible"
        : "✗ not visible";
    return `  - ${name}: ${score.toFixed(2)} ${status}`;
  });

  const supportingLandmarkLines = framing.landmarks.supporting.map((name) => {
    const score = confidenceReport.landmarks[name] ?? 0;
    const status =
      score >= framing.confidenceThresholds.supporting
        ? "✓ adequate"
        : "⚠ weak";
    return `  - ${name}: ${score.toFixed(2)} ${status}`;
  });

  // Format patient type for prompt
  const patientTypeLabel: Record<PatientProfile["type"], string> = {
    senior: "Senior or elderly patient — use simple, calm, reassuring language",
    post_surgery: "Post-surgery rehab patient — be precise and safety-conscious",
    chronic_pain: "Chronic pain or mobility patient — be gentle, acknowledge difficulty",
    general_fitness: "General fitness user — clear and direct language is appropriate"
  };

  const familiarityLabel: Record<PatientProfile["exerciseFamiliarity"], string> = {
    first_time: "First time doing this exercise — may need more explanation",
    some_experience: "Has done this exercise before — brief instruction is fine",
    practiced: "Practiced with this exercise — one-word cues are sufficient"
  };

  return `You are a physiotherapy assistant evaluating whether the camera framing is adequate before or during an exercise session.

PATIENT PROFILE:
- Type: ${patientTypeLabel[patientProfile.type]}
- Exercise familiarity: ${familiarityLabel[patientProfile.exerciseFamiliarity]}
- Session number: ${patientProfile.sessionNumber}

EXERCISE:
- Name: ${prescription.name}
- Clinical intent: ${framing.intent}
- Measurement risk if framing fails: ${framing.measurementRisk}
- Camera angle guidance: ${framing.angleGuidance}
- Required body coverage: ${framing.requiredCoverage}
- Required start posture: ${framing.requiredStartPosture}
- Bilateral symmetry required: ${framing.bilateralSymmetryRequired}

CURRENT FRAMING STATUS:
- Person detected: ${confidenceReport.personDetected}
- Estimated coverage: ${confidenceReport.estimatedCoverage}
- Estimated posture: ${confidenceReport.estimatedPosture}
- Patient centered: ${confidenceReport.isCentered}

Critical landmarks (must be visible):
${criticalLandmarkLines.join("\n")}

Supporting landmarks (should be visible):
${supportingLandmarkLines.join("\n")}

Issues detected:
- Critical landmarks lost: ${framingStatus.criticalLandmarksLost.join(", ") || "none"}
- Supporting landmarks weak: ${framingStatus.supportingLandmarksWeak.join(", ") || "none"}
- Coverage adequate: ${framingStatus.coverageAdequate}
- Posture correct: ${framingStatus.postureCorrect}
- Bilateral symmetry ok: ${framingStatus.bilateralSymmetryOk}
- Issue has persisted for: ${Math.round(framingStatus.severityDurationMs / 1000)} seconds

YOUR TASK:
1. Determine if this framing will allow clinically valid measurement of the exercise.
2. If framing is not adequate, write ONE clear instruction for the patient to fix it.
3. Adapt your language to the patient type above.
4. Be specific — tell them exactly what to move or adjust, not just "step back."
5. Keep patient instruction under 15 words.
6. Do not use technical terms like "landmark" or "confidence score."

Respond with valid JSON only. No explanation outside the JSON:
{
  "adequate": boolean,
  "willMeasurementBeValid": boolean,
  "severity": "ok" | "warning" | "critical",
  "patientInstruction": "string or null if adequate",
  "clinicalNote": "brief internal note about the measurement risk"
}`;
}

// ============================================================
// RESPONSE PARSER
// ============================================================

type RawAiResponse = {
  adequate: boolean;
  willMeasurementBeValid: boolean;
  severity: "ok" | "warning" | "critical";
  patientInstruction: string | null;
  clinicalNote: string;
};

function parseAiResponse(
  raw: string,
  exerciseId: string,
  receivedAtMs: number,
  isStillRelevant: boolean
): FramingEvaluationResult {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json|```/g, "").trim();

  const parsed: RawAiResponse = JSON.parse(cleaned);

  return {
    adequate: Boolean(parsed.adequate),
    willMeasurementBeValid: Boolean(parsed.willMeasurementBeValid),
    severity: parsed.severity ?? "warning",
    patientInstruction: parsed.patientInstruction ?? null,
    clinicalNote: parsed.clinicalNote ?? "",
    exerciseId,
    receivedAtMs,
    isStillRelevant
  };
}

// ============================================================
// FRAMING EVALUATOR CLASS
// ============================================================

const TIMEOUT_MS = 4000;

export class FramingEvaluator {
  private pendingEvaluationId: string | null = null;
  private lastResult: FramingEvaluationResult | null = null;
  private isEvaluating = false;

  // ----------------------------------------------------------
  // EVALUATE (async)
  // Triggers an AI framing evaluation.
  // Returns immediately — result arrives via callback.
  // If a previous evaluation is still pending, it is
  // cancelled (result will be marked isStillRelevant: false).
  // ----------------------------------------------------------

  async evaluate(
    prescription: ExercisePrescription,
    framingStatus: FramingStatus,
    confidenceReport: LandmarkConfidenceReport,
    patientProfile: PatientProfile,
    onResult: (result: FramingEvaluationResult) => void,
    onFallback: (instruction: string) => void
  ): Promise<void> {
    // Generate a unique ID for this evaluation
    const evaluationId = `framing-${prescription.id}-${Date.now()}`;
    this.pendingEvaluationId = evaluationId;
    this.isEvaluating = true;

    // Set up timeout — fires fallback if AI is too slow
    const timeoutHandle = window.setTimeout(() => {
      if (this.pendingEvaluationId === evaluationId) {
        this.isEvaluating = false;
        const fallback =
          framingStatus.fallbackInstruction ??
          "Adjust your position so I can see you clearly.";
        onFallback(fallback);
      }
    }, TIMEOUT_MS);

    try {
      const prompt = buildFramingPrompt(
        prescription,
        framingStatus,
        confidenceReport,
        patientProfile
      );

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system:
            "You are a physiotherapy assistant. You evaluate camera framing for exercise sessions. Always respond with valid JSON only.",
          messages: [{ role: "user", content: prompt }]
        })
      });

      // Clear timeout — we got a response in time
      window.clearTimeout(timeoutHandle);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const rawText = data.content
        ?.map((item: { type: string; text?: string }) =>
          item.type === "text" ? item.text ?? "" : ""
        )
        .join("");

      const isStillRelevant = this.pendingEvaluationId === evaluationId;

      const result = parseAiResponse(
        rawText,
        prescription.id,
        Date.now(),
        isStillRelevant
      );

      this.lastResult = result;
      this.isEvaluating = false;

      // Only deliver result if this evaluation is still current
      if (isStillRelevant) {
        onResult(result);
      }
    } catch (error) {
      window.clearTimeout(timeoutHandle);
      this.isEvaluating = false;

      // API failed — fire fallback immediately
      if (this.pendingEvaluationId === evaluationId) {
        const fallback =
          framingStatus.fallbackInstruction ??
          "Adjust your position so I can see you clearly.";
        onFallback(fallback);
      }
    }
  }

  // ----------------------------------------------------------
  // CANCEL
  // Called when exercise changes — marks any pending
  // evaluation as no longer relevant
  // ----------------------------------------------------------

  cancel(): void {
    this.pendingEvaluationId = null;
    this.isEvaluating = false;
  }

  getLastResult(): FramingEvaluationResult | null {
    return this.lastResult;
  }

  getIsEvaluating(): boolean {
    return this.isEvaluating;
  }
}
