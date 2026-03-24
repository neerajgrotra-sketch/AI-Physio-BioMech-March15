export type MovementPhase =
  | "ready"
  | "lifting"
  | "holding"
  | "lowering"
  | "complete"
  | "unknown";

export type AffectedSide = "left" | "right" | "both" | "none" | "unknown";

export type ObservationPattern =
  | "insufficient_range"
  | "early_drop"
  | "unstable_hold"
  | "poor_lowering_control"
  | "excessive_torso_lean"
  | "shoulder_hike"
  | "asymmetry"
  | "wrong_side_participation"
  | "other_side_not_active"
  | "stopped_moving"
  | "good_control"
  | "improving_range"
  | "recovered_hold";

export type ObservationTrend = "improving" | "stable" | "worsening" | "unknown";

export interface Observation {
  id: string;
  pattern: ObservationPattern;
  confidence: number;
  repsSeen: number;
  trend: ObservationTrend;
  affectedSide: AffectedSide;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  emittedAtMs: number;
  exerciseId: string;
  repRange: {
    firstRep: number;
    lastRep: number;
  };
  supportingPhases: MovementPhase[];
  sourceIssueKeys: string[];
  metadata?: {
    averageHoldElapsedMs?: number;
    averageTargetDeficit?: number;
    averageLoweringDurationMs?: number;
    averageTorsoLeanDeg?: number;
    averageAsymmetryDeg?: number;
    notes?: string[];
  };
}

export type VoiceIntentPriority = 1 | 2 | 3 | 4 | 5;

export type VoiceIntentKind =
  | "framing"
  | "exercise_intro"
  | "posture_setup"
  | "hold_cue"
  | "correction"
  | "encouragement"
  | "recovery"
  | "rep_feedback"
  | "exercise_transition"
  | "safety"
  | "silence_marker";

export interface VoiceIntent {
  id: string;
  kind: VoiceIntentKind;
  text: string;
  priority: VoiceIntentPriority;
  speakDuringPhases: MovementPhase[];
  validWhile: () => boolean;
  triggerAtHoldMs?: number;
  expiresAfterMs: number;
  cancelIfPhaseChanges: boolean;
  createdAt: number;
  sourceObservationId?: string;
  sourcePattern?: ObservationPattern;
  exerciseId?: string;
  repContext?: {
    repCount: number;
    isRecoveryRep?: boolean;
    followsFailure?: boolean;
  };
  timing?: {
    earliestSpeakAtMs?: number;
    latestSpeakAtMs?: number;
    mandatorySilenceAfterMs?: number;
  };
  interruption?: {
    canInterruptCurrentSpeech: boolean;
    flushLowerPriorityQueue: boolean;
  };
}

export type BehaviourApproachLevel = "silent" | "gentle" | "redirect";

export type BehaviourMode =
  | "observing"
  | "preparing_intro"
  | "guiding_hold"
  | "waiting_for_response"
  | "recovering_failed_hold"
  | "exercise_transition"
  | "idle";

export interface IssueEscalationRecord {
  issueKey: string;
  occurrenceCount: number;
  lastObservedAtRep: number;
  lastCorrectedAtRep: number | null;
  lastCorrectedAtMs: number | null;
  lastOutcome: "ignored" | "corrected" | "improved" | "unchanged" | "worsened";
  approachLevel: BehaviourApproachLevel;
  affectedSide: AffectedSide;
  isActive: boolean;
}

export interface HoldCueStep {
  id: string;
  offsetMs: number;
  text: string;
  priority: VoiceIntentPriority;
  cancelIfPhaseChanges: boolean;
  validDuringPhase: "holding";
}

export interface HoldCueSchedule {
  scheduleId: string;
  exerciseId: string;
  holdRequiredMs: number;
  steps: HoldCueStep[];
  recoveryVariant?: {
    enabled: boolean;
    steps: HoldCueStep[];
  };
  tooLongHoldRule?: {
    thresholdOffsetMs: number;
    text: string;
    priority: VoiceIntentPriority;
  };
}

export interface PhysioBehaviourState {
  sessionId: string;
  exerciseId: string | null;
  mode: BehaviourMode;
  currentPhase: MovementPhase;
  currentRepCount: number;
  lastRepCompletedAtMs: number | null;
  lastSpokenAtMs: number | null;
  silenceUntilMs: number | null;
  lastIntentId: string | null;
  lastIntentKind: VoiceIntentKind | null;
  lastCueWasCorrection: boolean;
  lastCueWasEncouragement: boolean;
  activeObservationId: string | null;
  activeObservationPattern: ObservationPattern | null;
  queuedHoldScheduleId: string | null;
  holdCueProgress: {
    scheduleId: string | null;
    startedAtMs: number | null;
    firedStepIds: string[];
    cancelledAtMs: number | null;
    completedAtMs: number | null;
  };
  recoveryState: {
    active: boolean;
    triggeredByObservationId: string | null;
    failedRepNumber: number | null;
    recoveryRepNumber: number | null;
    successAcknowledged: boolean;
  };
  issueEscalation: Record<string, IssueEscalationRecord>;
  observationMemory: {
    recentObservationIds: string[];
    ignoredObservationIds: string[];
    lastAcknowledgedGoodRepAtRep: number | null;
  };
}