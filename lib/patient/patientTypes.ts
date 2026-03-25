// ============================================================
// lib/patient/patientTypes.ts
// ============================================================
// Patient profile and session context type definitions.
//
// These types travel through every AI call in the system:
// - Framing evaluations
// - Live coaching decisions
// - Encouragement tone selection
// - Session summaries
// - Adaptive difficulty suggestions
//
// They are the answer to: "who is this person and how are
// they doing right now?"
// ============================================================

// ============================================================
// PATIENT TYPE
// ============================================================
// The four patient types drive AI tone and language complexity.
// Each type gets a different default coaching register.
//
// senior          — calm, simple, reassuring, no jargon
// post_surgery    — precise, safety-conscious, methodical
// chronic_pain    — gentle, acknowledges difficulty, patient
// general_fitness — clear, direct, efficient
// ============================================================

export type PatientType =
  | "senior"
  | "post_surgery"
  | "chronic_pain"
  | "general_fitness";

// ============================================================
// EXERCISE FAMILIARITY
// ============================================================
// How well does this patient know this specific exercise?
// Drives instruction verbosity — first-time patients need
// more explanation, practiced patients need only cues.
// ============================================================

export type ExerciseFamiliarity =
  | "first_time"
  | "some_experience"
  | "practiced";

// ============================================================
// SESSION FATIGUE LEVEL
// ============================================================
// Derived during the session from hold duration trends,
// failure patterns, and rep completion rate.
// Passed to AI so it can soften or adjust coaching tone.
// ============================================================

export type FatigueLevel =
  | "none"       // performing well, no fatigue signs
  | "mild"       // slight degradation in hold times or range
  | "significant"; // multiple failures, worsening trend

// ============================================================
// SESSION SENTIMENT
// ============================================================
// How is the patient doing emotionally/physically right now?
// Derived from rep success/failure pattern over last 3 reps.
// Drives AI tone — struggling patients need encouragement,
// confident patients need less hand-holding.
// ============================================================

export type SessionSentiment =
  | "progressing"   // improving or consistent success
  | "neutral"       // mixed results, no clear trend
  | "struggling"    // multiple failures, worsening
  | "frustrated";   // prolonged hesitation or stopped moving

// ============================================================
// PATIENT PROFILE
// ============================================================
// Stable per-session profile — set at session start,
// does not change during the session.
// ============================================================

export type PatientProfile = {
  // Primary patient type — drives AI language register
  type: PatientType;

  // Session number — AI uses this to calibrate detail level
  // Session 1 gets more explanation, later sessions get cues
  sessionNumber: number;

  // Whether this patient has used the platform before
  isReturningPatient: boolean;

  // Optional free-text clinical notes visible to AI
  // e.g. "right shoulder replacement, limited range expected"
  clinicalNotes: string | null;
};

export function createDefaultPatientProfile(): PatientProfile {
  return {
    type: "general_fitness",
    sessionNumber: 1,
    isReturningPatient: false,
    clinicalNotes: null
  };
}

// ============================================================
// EXERCISE SESSION CONTEXT
// ============================================================
// Runtime context for the current exercise.
// Updated continuously during exercise execution.
// Passed to AI with every coaching and framing decision.
// ============================================================

export type ExerciseSessionContext = {
  // Which exercise is active
  exerciseId: string;
  exerciseName: string;

  // Position in the session queue
  exerciseIndexInSession: number;
  totalExercisesInSession: number;

  // How familiar is this patient with this exercise?
  exerciseFamiliarity: ExerciseFamiliarity;

  // Current rep progress
  repCount: number;
  repTarget: number;

  // Running tallies for this exercise
  successfulReps: number;
  failedReps: number;

  // Failure breakdown — what has been going wrong
  failureReasons: {
    height: number;
    hold: number;
    balance: number;
    isolation: number;
    bilateral: number;
  };

  // Fatigue state — derived from hold time trends
  fatigueLevel: FatigueLevel;

  // Sentiment — derived from recent rep pattern
  sentiment: SessionSentiment;

  // Cue history — what has been said and whether it helped
  cueHistory: CueRecord[];

  // Timestamp when exercise started
  startedAtMs: number;
};

// ============================================================
// CUE RECORD
// ============================================================
// Records every coaching cue delivered during a session.
// The AI reads this to avoid repeating itself and to
// assess whether previous cues worked.
// ============================================================

export type CueOutcome =
  | "helped"       // next rep showed improvement
  | "no_change"    // next rep showed no improvement
  | "worsened"     // next rep was worse
  | "pending";     // next rep not yet completed

export type CueRecord = {
  // Unique identifier for this cue
  id: string;

  // When was it delivered
  deliveredAtMs: number;
  deliveredAtRep: number;

  // What was said
  text: string;

  // What triggered it
  triggerPattern: string;

  // What happened after
  outcome: CueOutcome;
};

// ============================================================
// SESSION SUMMARY INPUT
// ============================================================
// Assembled at session end and sent to AI for
// generating a clinical session summary.
// ============================================================

export type SessionSummaryInput = {
  patientProfile: PatientProfile;

  // All exercises completed in this session
  exercises: ExerciseSessionContext[];

  // Total session duration
  totalDurationMs: number;

  // Overall session sentiment trajectory
  // How did the patient progress across the whole session?
  overallSentimentTrajectory: SessionSentiment[];
};

// ============================================================
// FATIGUE INDICATOR CALCULATION
// ============================================================
// Derives fatigue level from hold duration trend.
// Called from the inference loop after each rep.
// ============================================================

export function deriveFatigueLevel(
  holdDurations: number[],
  holdTargetMs: number,
  failedRepCount: number
): FatigueLevel {
  if (holdDurations.length < 2) return "none";

  // Check if hold durations are declining
  const recent = holdDurations.slice(-3);
  const earliest = recent[0];
  const latest = recent[recent.length - 1];

  const holdDeclineRatio =
    earliest > 0 ? (earliest - latest) / earliest : 0;

  // Significant hold decline = fatigue signal
  if (holdDeclineRatio > 0.4 || failedRepCount >= 3) {
    return "significant";
  }

  if (holdDeclineRatio > 0.2 || failedRepCount >= 2) {
    return "mild";
  }

  return "none";
}

// ============================================================
// SENTIMENT CALCULATION
// ============================================================
// Derives session sentiment from recent rep outcomes.
// Called from the inference loop after each rep.
// ============================================================

export function deriveSessionSentiment(
  recentOutcomes: Array<"success" | "failed">,
  hesitationDurationMs: number
): SessionSentiment {
  // Prolonged hesitation between reps = frustrated
  if (hesitationDurationMs > 15000) return "frustrated";

  if (recentOutcomes.length === 0) return "neutral";

  const recentWindow = recentOutcomes.slice(-3);
  const successCount = recentWindow.filter(o => o === "success").length;
  const failCount = recentWindow.filter(o => o === "failed").length;

  if (successCount >= 2) return "progressing";
  if (failCount >= 2) return "struggling";

  return "neutral";
}

// ============================================================
// EXERCISE SESSION CONTEXT FACTORY
// ============================================================

export function createExerciseSessionContext(
  exerciseId: string,
  exerciseName: string,
  exerciseIndexInSession: number,
  totalExercisesInSession: number,
  repTarget: number,
  patientProfile: PatientProfile
): ExerciseSessionContext {
  // Familiarity increases with session number
  // Session 1 = first_time, 2-3 = some_experience, 4+ = practiced
  const familiarity: ExerciseFamiliarity =
    patientProfile.sessionNumber === 1
      ? "first_time"
      : patientProfile.sessionNumber <= 3
      ? "some_experience"
      : "practiced";

  return {
    exerciseId,
    exerciseName,
    exerciseIndexInSession,
    totalExercisesInSession,
    exerciseFamiliarity: familiarity,
    repCount: 0,
    repTarget,
    successfulReps: 0,
    failedReps: 0,
    failureReasons: {
      height: 0,
      hold: 0,
      balance: 0,
      isolation: 0,
      bilateral: 0
    },
    fatigueLevel: "none",
    sentiment: "neutral",
    cueHistory: [],
    startedAtMs: Date.now()
  };
}
