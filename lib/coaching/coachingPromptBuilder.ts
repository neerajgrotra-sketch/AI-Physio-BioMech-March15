// ============================================================
// lib/coaching/coachingPromptBuilder.ts
// ============================================================
// Builds the exact prompt sent to Claude for each
// coaching scenario.
//
// Each trigger type gets a tailored prompt that:
// - Gives Claude the clinical context it needs
// - Instructs it on tone based on patient type
// - Constrains response format and length
// - Provides the deterministic fallback strings as reference
//
// Claude reads this and decides:
// 1. Should I speak? (speak: true/false)
// 2. What should I say? (text: string)
//
// The "should I speak" decision is genuinely valuable —
// it prevents over-coaching when the patient is doing well.
// ============================================================

import type { ClinicalContext, CoachingTrigger } from "@/lib/coaching/clinicalContextAssembler";
import type { PatientType } from "@/lib/patient/patientTypes";

// ============================================================
// PATIENT TONE INSTRUCTIONS
// ============================================================

function getPatientToneInstruction(type: PatientType): string {
  switch (type) {
    case "senior":
      return "The patient is a senior or elderly person. Use simple, calm, warm language. Short sentences. No medical jargon. Be reassuring and unhurried. Never use words like 'reps', 'sets', or 'range of motion' — say 'movements' or 'times' instead.";

    case "post_surgery":
      return "The patient is recovering from surgery. Be precise and safety-conscious. Acknowledge their effort. Be methodical. It is fine to use clinical language like 'hold position' and 'controlled movement'. Always err on the side of caution.";

    case "chronic_pain":
      return "The patient has chronic pain or mobility limitations. Be gentle and patient. Acknowledge that this is difficult. Never push. If they are struggling, it is better to encourage a modified effort than to correct failure. Use soft language — 'try to' rather than 'you must'.";

    case "general_fitness":
      return "The patient is a general fitness user. Clear, direct, efficient language. No need to over-explain. Cues can be brief — one or two words if the context is clear. Maintain a professional but energetic tone.";
  }
}

// ============================================================
// FAMILIARITY INSTRUCTION
// ============================================================

function getFamiliarityInstruction(
  familiarity: string,
  sessionNumber: number
): string {
  if (familiarity === "first_time" || sessionNumber === 1) {
    return "This is the patient's first time with this exercise. You may include brief explanatory context in your instruction — not just what to do but why it matters.";
  }
  if (familiarity === "some_experience" || sessionNumber <= 3) {
    return "The patient has some experience with this exercise. Keep instructions brief — one clear sentence is ideal.";
  }
  return "The patient is practiced with this exercise. Use short cues only. They know the movement.";
}

// ============================================================
// SHARED CONTEXT BLOCK
// ============================================================
// This block appears in every prompt and gives Claude
// the full picture before it makes any decision.
// ============================================================

function buildSharedContextBlock(ctx: ClinicalContext): string {
  const { patientProfile, prescription, sessionPosition, performance, cueHistory } = ctx;

  const repProgress = `${sessionPosition.repCount} of ${sessionPosition.repTarget} reps completed`;

  const failureSummary =
    performance.failedReps === 0
      ? "No failed reps so far."
      : `${performance.failedReps} failed rep(s). ${
          performance.dominantFailureReason
            ? `Most common issue: ${performance.dominantFailureReason}.`
            : ""
        }`;

  const cueSummary =
    cueHistory.totalCuesGiven === 0
      ? "No coaching cues given yet this exercise."
      : `${cueHistory.totalCuesGiven} cue(s) given. Last: "${cueHistory.lastCueText}" — outcome: ${cueHistory.lastCueOutcome}.${
          cueHistory.repeatedPattern
            ? ` Note: the pattern "${cueHistory.repeatedPattern}" has been seen 3+ times.`
            : ""
        }`;

  const clinicalNotes = patientProfile.clinicalNotes
    ? `Clinical notes: ${patientProfile.clinicalNotes}`
    : "";

  return `PATIENT:
- Type: ${patientProfile.type}
- Session number: ${patientProfile.sessionNumber}
- Returning patient: ${patientProfile.isReturningPatient}
${clinicalNotes}

EXERCISE: ${prescription.name}
- Progress: ${repProgress}
- Hold required: ${prescription.holdRequired ? `Yes — ${prescription.holdDurationMs / 1000}s` : "No"}
- Patient fatigue: ${performance.fatigueLevel}
- Patient sentiment: ${performance.sentiment}

PERFORMANCE: ${failureSummary}

CUE HISTORY: ${cueSummary}

FALLBACK STRINGS (use as style reference, not literal output):
- Lift cue: "${prescription.coachingStrings.lift}"
- Hold cue: "${prescription.coachingStrings.hold}"
- Success: "${prescription.coachingStrings.success}"
- Failed height: "${prescription.coachingStrings.failedHeight}"
- Failed hold: "${prescription.coachingStrings.failedHold}"`;
}

// ============================================================
// RESPONSE FORMAT INSTRUCTION
// ============================================================

const RESPONSE_FORMAT = `Respond with valid JSON only. No text outside the JSON:
{
  "speak": boolean,
  "text": "string — what to say to the patient, or null if speak is false",
  "tone": "encouraging" | "corrective" | "neutral" | "urgent",
  "reasoning": "one sentence — why you made this choice"
}`;

// ============================================================
// PROMPT BUILDERS PER TRIGGER TYPE
// ============================================================

function buildRepCompletedPrompt(ctx: ClinicalContext): string {
  const { patientProfile, sessionPosition, performance, cueHistory } = ctx;

  const isStreak =
    performance.successfulReps >= 3 && performance.failedReps === 0;
  const isRecovery =
    performance.failedReps >= 1 &&
    performance.successfulReps > 0 &&
    cueHistory.lastCueOutcome === "pending";

  return `You are a physiotherapy coach. A patient just completed a successful rep.

${getPatientToneInstruction(patientProfile.type)}
${getFamiliarityInstruction(ctx.prescription.coachingStrings.lift, patientProfile.sessionNumber)}

${buildSharedContextBlock(ctx)}

WHAT JUST HAPPENED: Successful rep completed.
${isStreak ? "Note: Patient has completed 3+ reps in a row without failure." : ""}
${isRecovery ? "Note: This rep succeeded after a previous failure — this is a recovery rep." : ""}
${sessionPosition.isFinalRep ? "Note: This was the FINAL rep of the exercise." : ""}
${sessionPosition.isFirstRep ? "Note: This was the FIRST rep." : ""}

DECISION GUIDANCE:
- If the patient is doing well consistently, silence is often better than praise.
- Only speak if the rep had something worth acknowledging (first rep, recovery, final rep, or after a period of failure).
- If you do speak, keep it short — 2 to 8 words is ideal for a successful rep.
- Never repeat the same encouragement that was just given.

${RESPONSE_FORMAT}`;
}

function buildRepFailedPrompt(ctx: ClinicalContext): string {
  const { patientProfile, trigger, performance } = ctx;

  const failureReason = trigger.failureReason ?? "unknown";
  const isRepeatedFailure = performance.failedReps >= 2;
  const dominantReason = performance.dominantFailureReason;

  return `You are a physiotherapy coach. A patient just failed a rep.

${getPatientToneInstruction(patientProfile.type)}
${getFamiliarityInstruction(ctx.prescription.coachingStrings.lift, patientProfile.sessionNumber)}

${buildSharedContextBlock(ctx)}

WHAT JUST HAPPENED: Rep failed.
Failure reason this rep: ${failureReason}
${isRepeatedFailure ? `This is a repeated failure. Dominant pattern: ${dominantReason ?? failureReason}.` : "First failure of this exercise."}

DECISION GUIDANCE:
- Always speak after a failure — silence after a failed rep is confusing.
- If this is the first failure, give a gentle, specific correction.
- If this is a repeated failure with the same reason, escalate — be more direct and specific.
- If patient is struggling (sentiment: struggling or fatigue: significant), be encouraging first, corrective second.
- If patient is a senior or chronic pain type, never make them feel they did something wrong — frame as "let's try again."
- Keep the correction specific to the failure reason. Do not give general encouragement after a failure.
- Maximum 15 words.

${RESPONSE_FORMAT}`;
}

function buildHoldStartedPrompt(ctx: ClinicalContext): string {
  const { patientProfile, trigger } = ctx;
  const holdSec = trigger.holdRequiredMs
    ? Math.round(trigger.holdRequiredMs / 1000)
    : 0;

  return `You are a physiotherapy coach. The patient has just entered the hold phase of a rep.

${getPatientToneInstruction(patientProfile.type)}

${buildSharedContextBlock(ctx)}

WHAT JUST HAPPENED: Patient reached the target position and hold phase has started.
Hold required: ${holdSec} seconds.
${ctx.performance.failedReps >= 1 ? "Note: Patient has failed at least one hold already this exercise." : ""}

DECISION GUIDANCE:
- This is a good moment to acknowledge the position and encourage holding.
- Keep it brief — the patient needs to focus on holding, not processing language.
- If patient has failed holds before, add a gentle reminder about the duration.
- Ideal response: 3 to 8 words.
- Do not count down the seconds — that is handled by the UI.

${RESPONSE_FORMAT}`;
}

function buildObservationReadyPrompt(ctx: ClinicalContext): string {
  const { patientProfile, trigger, performance } = ctx;
  const observation = trigger.observation;

  if (!observation) {
    return buildRepCompletedPrompt(ctx);
  }

  return `You are a physiotherapy coach. A movement pattern has been observed consistently over multiple reps.

${getPatientToneInstruction(patientProfile.type)}
${getFamiliarityInstruction(ctx.prescription.coachingStrings.lift, patientProfile.sessionNumber)}

${buildSharedContextBlock(ctx)}

OBSERVED PATTERN:
- Pattern: ${observation.pattern}
- Confidence: ${Math.round(observation.confidence * 100)}%
- Seen across reps: ${observation.repRange.firstRep} to ${observation.repRange.lastRep}
- Trend: ${observation.trend}
- Affected side: ${observation.affectedSide}
${observation.metadata?.notes ? `- Notes: ${observation.metadata.notes.join(", ")}` : ""}

DECISION GUIDANCE:
- This pattern has been confirmed across multiple reps — it is not a fluke.
- Decide whether to give a correction or encouragement based on the pattern type.
- If trend is "improving", consider encouragement instead of correction.
- If trend is "worsening" or "stable" with a problem pattern, give a correction.
- If patient is struggling overall AND this is a minor issue, consider staying silent.
- If you have already given a cue for this pattern and it did not help, escalate — be more specific.
- Maximum 15 words.

${RESPONSE_FORMAT}`;
}

function buildHesitationDetectedPrompt(ctx: ClinicalContext): string {
  const { patientProfile, performance } = ctx;

  return `You are a physiotherapy coach. The patient has stopped moving between reps for an unusually long time.

${getPatientToneInstruction(patientProfile.type)}

${buildSharedContextBlock(ctx)}

WHAT IS HAPPENING: Patient has paused between reps for more than 12 seconds.
Patient sentiment: ${performance.sentiment}
Patient fatigue: ${performance.fatigueLevel}

DECISION GUIDANCE:
- Always speak — hesitation after a pause needs acknowledgement.
- If fatigue is significant, offer a rest rather than pushing.
- If sentiment is struggling or frustrated, be warm and encouraging.
- If patient is doing well (neutral or progressing), a gentle prompt is enough.
- Never be impatient or create urgency — this may be a senior or someone in pain.
- Keep it short and warm — 5 to 10 words.

${RESPONSE_FORMAT}`;
}

function buildExerciseStartedPrompt(ctx: ClinicalContext): string {
  const { patientProfile, prescription, sessionPosition } = ctx;

  const holdInfo = prescription.holdRequired
    ? "Hold each rep for " + Math.round(prescription.holdDurationMs / 1000) + " seconds."
    : "No hold required.";

  const isTransition = !sessionPosition.isFirstExercise;

  return `You are a physiotherapy coach. ${isTransition ? "The session is moving to the next exercise." : "A new exercise session is starting."}

${getPatientToneInstruction(patientProfile.type)}
${getFamiliarityInstruction(ctx.prescription.coachingStrings.lift, patientProfile.sessionNumber)}

${buildSharedContextBlock(ctx)}

EXERCISE DETAILS:
- Name: ${prescription.name}
- Target: ${prescription.repTarget} repetitions
- Hold: ${holdInfo}
- Movement: ${prescription.coachingStrings.lift}
- Exercise ${sessionPosition.exerciseIndex + 1} of ${sessionPosition.totalExercises} in this session
${sessionPosition.isFirstExercise ? "- This is the FIRST exercise of the session." : "- This is a TRANSITION from the previous exercise."}
${patientProfile.isReturningPatient ? "- Returning patient — they know the drill, keep intro brief." : ""}

DECISION GUIDANCE:
- Always speak — the patient must know what exercise is coming and what to do.
- Your response MUST include: (1) the exercise name or movement, (2) the rep target, (3) the hold duration if applicable.
- For a FIRST exercise or FIRST session: give a clear, friendly explanation. Tell them the movement, how many reps, and how long to hold. Mention the purpose briefly (e.g. "builds shoulder strength").
- For a TRANSITION between exercises: announce the new exercise, reps, and hold. Keep it crisp — they are already warmed up.
- For returning patients or practiced familiarity: one sentence covering movement + reps + hold.
- For seniors and chronic pain patients: warm tone, reassure they can go at their own pace.
- Maximum 35 words. Cover all three elements: movement, repetition count, hold duration.

Example good responses:
- "Next up: right arm raise. Lift to shoulder height, hold for 2 seconds, 6 times. Take it steady."
- "Now we are doing sit to stand — stand up fully, hold briefly, then sit back down. Five times."
- "Right arm raises — lift to shoulder height, hold 2 seconds, lower slowly. Six times, when you are ready."

${RESPONSE_FORMAT}`;
}

function buildExerciseCompletingPrompt(ctx: ClinicalContext): string {
  const { patientProfile, performance, sessionPosition } = ctx;

  return `You are a physiotherapy coach. The patient has just completed the final rep of an exercise.

${getPatientToneInstruction(patientProfile.type)}

${buildSharedContextBlock(ctx)}

WHAT JUST HAPPENED: Final rep completed. Exercise is finishing.
${sessionPosition.isLastExercise ? "This was the LAST exercise of the entire session." : `Next exercise follows.`}
Overall: ${performance.successfulReps} successful, ${performance.failedReps} failed.

DECISION GUIDANCE:
- Always speak at exercise completion.
- Acknowledge what went well, not just that they finished.
- If there were failures, do not dwell on them — focus on effort and what to improve next time.
- If this is the last exercise of the session, make it feel like a proper closing.
- For seniors and chronic pain patients, always affirm the effort regardless of performance.
- 5 to 15 words.

${RESPONSE_FORMAT}`;
}

// ============================================================
// MAIN PROMPT BUILDER
// ============================================================

export function buildCoachingPrompt(ctx: ClinicalContext): string {
  switch (ctx.trigger.type) {
    case "rep_completed":
      return buildRepCompletedPrompt(ctx);

    case "rep_failed":
      return buildRepFailedPrompt(ctx);

    case "hold_started":
      return buildHoldStartedPrompt(ctx);

    case "observation_ready":
      return buildObservationReadyPrompt(ctx);

    case "hesitation_detected":
      return buildHesitationDetectedPrompt(ctx);

    case "exercise_started":
      return buildExerciseStartedPrompt(ctx);

    case "exercise_completing":
      return buildExerciseCompletingPrompt(ctx);

    default:
      return buildRepCompletedPrompt(ctx);
  }
}

// ============================================================
// COACHING RESPONSE TYPE
// ============================================================

export type CoachingResponse = {
  speak: boolean;
  text: string | null;
  tone: "encouraging" | "corrective" | "neutral" | "urgent";
  reasoning: string;
};

export function parseCoachingResponse(raw: string): CoachingResponse | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      speak: Boolean(parsed.speak),
      text: parsed.text ?? null,
      tone: parsed.tone ?? "neutral",
      reasoning: parsed.reasoning ?? ""
    };
  } catch {
    return null;
  }
}
