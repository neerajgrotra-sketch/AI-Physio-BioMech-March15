import type {
  Observation,
  PhysioBehaviourState,
  VoiceIntent,
  HoldCueSchedule,
  IssueEscalationRecord,
  MovementPhase,
  ObservationPattern,
  AffectedSide
} from "./types";

type BehaviourInput = {
  sessionId: string;
  exerciseId: string;
  phase: MovementPhase;
  repCount: number;
  holdElapsedMs: number | null;
  holdRequiredMs: number | null;
  observations: Observation[];
  nowMs: number;
};

type BehaviourOutput = {
  nextState: PhysioBehaviourState;
  intents: VoiceIntent[];
};

function createIssueKey(pattern: ObservationPattern, side: AffectedSide): string {
  return `${pattern}:${side}`;
}

function createEmptyBehaviourState(sessionId: string): PhysioBehaviourState {
  return {
    sessionId,
    exerciseId: null,
    mode: "idle",
    currentPhase: "unknown",
    currentRepCount: 0,
    lastRepCompletedAtMs: null,
    lastSpokenAtMs: null,
    silenceUntilMs: null,
    lastIntentId: null,
    lastIntentKind: null,
    lastCueWasCorrection: false,
    lastCueWasEncouragement: false,
    activeObservationId: null,
    activeObservationPattern: null,
    queuedHoldScheduleId: null,
    holdCueProgress: {
      scheduleId: null,
      startedAtMs: null,
      firedStepIds: [],
      cancelledAtMs: null,
      completedAtMs: null
    },
    recoveryState: {
      active: false,
      triggeredByObservationId: null,
      failedRepNumber: null,
      recoveryRepNumber: null,
      successAcknowledged: false
    },
    issueEscalation: {},
    observationMemory: {
      recentObservationIds: [],
      ignoredObservationIds: [],
      lastAcknowledgedGoodRepAtRep: null
    }
  };
}

function createVoiceIntent(params: {
  id: string;
  kind: VoiceIntent["kind"];
  text: string;
  priority: VoiceIntent["priority"];
  speakDuringPhases: MovementPhase[];
  nowMs: number;
  expiresAfterMs?: number;
  cancelIfPhaseChanges?: boolean;
  sourceObservationId?: string;
  sourcePattern?: ObservationPattern;
  exerciseId?: string;
  repCount?: number;
  isRecoveryRep?: boolean;
  followsFailure?: boolean;
  triggerAtHoldMs?: number;
  mandatorySilenceAfterMs?: number;
  canInterruptCurrentSpeech?: boolean;
  flushLowerPriorityQueue?: boolean;
}): VoiceIntent {
  return {
    id: params.id,
    kind: params.kind,
    text: params.text,
    priority: params.priority,
    speakDuringPhases: params.speakDuringPhases,
    validWhile: () => true,
    triggerAtHoldMs: params.triggerAtHoldMs,
    expiresAfterMs: params.expiresAfterMs ?? 5000,
    cancelIfPhaseChanges: params.cancelIfPhaseChanges ?? true,
    createdAt: params.nowMs,
    sourceObservationId: params.sourceObservationId,
    sourcePattern: params.sourcePattern,
    exerciseId: params.exerciseId,
    repContext:
      params.repCount !== undefined
        ? {
            repCount: params.repCount,
            isRecoveryRep: params.isRecoveryRep,
            followsFailure: params.followsFailure
          }
        : undefined,
    timing: {
      mandatorySilenceAfterMs: params.mandatorySilenceAfterMs ?? 4500
    },
    interruption: {
      canInterruptCurrentSpeech: params.canInterruptCurrentSpeech ?? false,
      flushLowerPriorityQueue: params.flushLowerPriorityQueue ?? false
    }
  };
}

function createDefaultHoldSchedule(
  exerciseId: string,
  holdRequiredMs: number
): HoldCueSchedule {
  const cue2 = Math.round(holdRequiredMs * 0.4);
  const cue3 = Math.round(holdRequiredMs * 0.85);

  return {
    scheduleId: `hold-${exerciseId}-${holdRequiredMs}`,
    exerciseId,
    holdRequiredMs,
    steps: [
      {
        id: "hold-start",
        offsetMs: 0,
        text: "Good — hold it there.",
        priority: 4,
        cancelIfPhaseChanges: true,
        validDuringPhase: "holding"
      },
      {
        id: "hold-mid",
        offsetMs: cue2,
        text: "Keep it up… breathe…",
        priority: 3,
        cancelIfPhaseChanges: true,
        validDuringPhase: "holding"
      },
      {
        id: "hold-end",
        offsetMs: cue3,
        text: "And bring it down slowly.",
        priority: 4,
        cancelIfPhaseChanges: true,
        validDuringPhase: "holding"
      }
    ],
    recoveryVariant: {
      enabled: true,
      steps: [
        {
          id: "recovery-hold-start",
          offsetMs: 0,
          text: "Good — now hold it there.",
          priority: 4,
          cancelIfPhaseChanges: true,
          validDuringPhase: "holding"
        },
        {
          id: "recovery-hold-mid",
          offsetMs: cue2,
          text: "Keep it up… breathe…",
          priority: 3,
          cancelIfPhaseChanges: true,
          validDuringPhase: "holding"
        },
        {
          id: "recovery-hold-end",
          offsetMs: cue3,
          text: "And bring it down slowly.",
          priority: 4,
          cancelIfPhaseChanges: true,
          validDuringPhase: "holding"
        }
      ]
    },
    tooLongHoldRule: {
      thresholdOffsetMs: 2000,
      text: "Good — you can bring it down now, slowly.",
      priority: 4
    }
  };
}

function upsertEscalationRecord(
  current: Record<string, IssueEscalationRecord>,
  observation: Observation,
  repCount: number,
  nowMs: number
): Record<string, IssueEscalationRecord> {
  const issueKey = createIssueKey(observation.pattern, observation.affectedSide);
  const existing = current[issueKey];

  const occurrenceCount = (existing?.occurrenceCount ?? 0) + 1;

  let approachLevel: IssueEscalationRecord["approachLevel"] = "silent";
  if (occurrenceCount >= 3) {
    approachLevel = "redirect";
  } else if (occurrenceCount >= 2) {
    approachLevel = "gentle";
  }

  return {
    ...current,
    [issueKey]: {
      issueKey,
      occurrenceCount,
      lastObservedAtRep: repCount,
      lastCorrectedAtRep: existing?.lastCorrectedAtRep ?? null,
      lastCorrectedAtMs: existing?.lastCorrectedAtMs ?? null,
      lastOutcome: existing?.lastOutcome ?? "ignored",
      approachLevel,
      affectedSide: observation.affectedSide,
      isActive: true
    }
  };
}

function shouldStaySilent(
  state: PhysioBehaviourState,
  input: BehaviourInput
): boolean {
  if (input.phase === "lifting" || input.phase === "lowering") return true;
  if (state.silenceUntilMs !== null && input.nowMs < state.silenceUntilMs) return true;
  return false;
}

function buildCorrectionText(observation: Observation, approachLevel: string): string {
  switch (observation.pattern) {
    case "insufficient_range":
      return approachLevel === "redirect"
        ? "Let’s reset. This time, aim clearly for shoulder height."
        : "Try to raise a little higher — aim for shoulder height.";
    case "early_drop":
      return "You dropped that a little early — raise it back up and hold for the full time.";
    case "unstable_hold":
      return approachLevel === "redirect"
        ? "Let’s simplify it. Hold steady and keep the arm still."
        : "Try to keep the arm steadier while you hold.";
    case "stopped_moving":
      return "Whenever you’re ready, begin the next movement slowly.";
    default:
      return "Let’s slow it down and keep the movement controlled.";
  }
}

function buildEncouragementText(observation: Observation): string {
  switch (observation.pattern) {
    case "good_control":
      return "Good. That’s it.";
    case "improving_range":
      return "Good — that’s higher.";
    case "recovered_hold":
      return "Well done for holding it that time.";
    default:
      return "Good work.";
  }
}

export class PhysioBehaviourModel {
  update(
    state: PhysioBehaviourState | null,
    input: BehaviourInput
  ): BehaviourOutput {
    const currentState =
      state && state.sessionId === input.sessionId
        ? state
        : createEmptyBehaviourState(input.sessionId);

    let nextState: PhysioBehaviourState = {
      ...currentState,
      exerciseId: input.exerciseId,
      currentPhase: input.phase,
      currentRepCount: input.repCount,
      mode: "observing"
    };

    const intents: VoiceIntent[] = [];

    if (shouldStaySilent(nextState, input)) {
      return { nextState, intents };
    }

    for (const observation of input.observations) {
      nextState = {
        ...nextState,
        issueEscalation: upsertEscalationRecord(
          nextState.issueEscalation,
          observation,
          input.repCount,
          input.nowMs
        ),
        activeObservationId: observation.id,
        activeObservationPattern: observation.pattern,
        observationMemory: {
          ...nextState.observationMemory,
          recentObservationIds: [
            ...nextState.observationMemory.recentObservationIds.slice(-9),
            observation.id
          ]
        }
      };

      const issueKey = createIssueKey(observation.pattern, observation.affectedSide);
      const escalation = nextState.issueEscalation[issueKey];

      if (
        observation.pattern === "good_control" ||
        observation.pattern === "improving_range" ||
        observation.pattern === "recovered_hold"
      ) {
        if (!nextState.lastCueWasEncouragement) {
          intents.push(
            createVoiceIntent({
              id: `encourage-${observation.id}`,
              kind: "encouragement",
              text: buildEncouragementText(observation),
              priority: 3,
              speakDuringPhases: ["ready", "holding", "complete"],
              nowMs: input.nowMs,
              sourceObservationId: observation.id,
              sourcePattern: observation.pattern,
              exerciseId: input.exerciseId,
              repCount: input.repCount,
              mandatorySilenceAfterMs: 5000
            })
          );

          nextState = {
            ...nextState,
            lastCueWasEncouragement: true,
            lastCueWasCorrection: false,
            lastSpokenAtMs: input.nowMs,
            silenceUntilMs: input.nowMs + 5000,
            observationMemory: {
              ...nextState.observationMemory,
              lastAcknowledgedGoodRepAtRep: input.repCount
            }
          };
        }

        continue;
      }

      if (observation.pattern === "early_drop") {
        intents.push(
          createVoiceIntent({
            id: `recovery-early-drop-${observation.id}`,
            kind: "recovery",
            text: "You dropped that a little early — raise it back up and hold for the full three seconds.",
            priority: 5,
            speakDuringPhases: ["ready", "holding", "lowering"],
            nowMs: input.nowMs,
            sourceObservationId: observation.id,
            sourcePattern: observation.pattern,
            exerciseId: input.exerciseId,
            repCount: input.repCount,
            followsFailure: true,
            mandatorySilenceAfterMs: 2500,
            canInterruptCurrentSpeech: true,
            flushLowerPriorityQueue: true
          })
        );

        nextState = {
          ...nextState,
          mode: "recovering_failed_hold",
          recoveryState: {
            active: true,
            triggeredByObservationId: observation.id,
            failedRepNumber: input.repCount,
            recoveryRepNumber: input.repCount + 1,
            successAcknowledged: false
          },
          lastCueWasCorrection: true,
          lastCueWasEncouragement: false,
          lastSpokenAtMs: input.nowMs,
          silenceUntilMs: input.nowMs + 2500
        };

        continue;
      }

      if (!escalation) continue;

      if (escalation.approachLevel === "silent") {
        continue;
      }

      if (nextState.lastCueWasCorrection) {
        continue;
      }

      intents.push(
        createVoiceIntent({
          id: `correct-${observation.id}`,
          kind: "correction",
          text: buildCorrectionText(observation, escalation.approachLevel),
          priority: escalation.approachLevel === "redirect" ? 4 : 3,
          speakDuringPhases: ["ready", "holding", "complete"],
          nowMs: input.nowMs,
          sourceObservationId: observation.id,
          sourcePattern: observation.pattern,
          exerciseId: input.exerciseId,
          repCount: input.repCount,
          mandatorySilenceAfterMs: 5000
        })
      );

      nextState = {
        ...nextState,
        lastCueWasCorrection: true,
        lastCueWasEncouragement: false,
        lastSpokenAtMs: input.nowMs,
        silenceUntilMs: input.nowMs + 5000,
        issueEscalation: {
          ...nextState.issueEscalation,
          [issueKey]: {
            ...escalation,
            lastCorrectedAtRep: input.repCount,
            lastCorrectedAtMs: input.nowMs,
            lastOutcome: "corrected"
          }
        }
      };
    }

    if (
      input.phase === "holding" &&
      input.holdRequiredMs !== null &&
      input.holdElapsedMs !== null
    ) {
      const schedule = createDefaultHoldSchedule(input.exerciseId, input.holdRequiredMs);

      const relevantSteps = nextState.recoveryState.active && schedule.recoveryVariant?.enabled
        ? schedule.recoveryVariant.steps
        : schedule.steps;

      const alreadyFired = new Set(nextState.holdCueProgress.firedStepIds);

      for (const step of relevantSteps) {
        if (input.holdElapsedMs >= step.offsetMs && !alreadyFired.has(step.id)) {
          intents.push(
            createVoiceIntent({
              id: `hold-${step.id}-${input.repCount}`,
              kind: "hold_cue",
              text: step.text,
              priority: step.priority,
              speakDuringPhases: ["holding"],
              nowMs: input.nowMs,
              sourcePattern: nextState.activeObservationPattern ?? undefined,
              exerciseId: input.exerciseId,
              repCount: input.repCount,
              triggerAtHoldMs: step.offsetMs,
              mandatorySilenceAfterMs: 1000
            })
          );

          nextState = {
            ...nextState,
            mode: "guiding_hold",
            queuedHoldScheduleId: schedule.scheduleId,
            holdCueProgress: {
              ...nextState.holdCueProgress,
              scheduleId: schedule.scheduleId,
              startedAtMs:
                nextState.holdCueProgress.startedAtMs ?? input.nowMs - input.holdElapsedMs,
              firedStepIds: [...nextState.holdCueProgress.firedStepIds, step.id]
            }
          };
        }
      }

      if (
        schedule.tooLongHoldRule &&
        input.holdElapsedMs > input.holdRequiredMs + schedule.tooLongHoldRule.thresholdOffsetMs
      ) {
        intents.push(
          createVoiceIntent({
            id: `too-long-hold-${input.repCount}`,
            kind: "hold_cue",
            text: schedule.tooLongHoldRule.text,
            priority: schedule.tooLongHoldRule.priority,
            speakDuringPhases: ["holding"],
            nowMs: input.nowMs,
            exerciseId: input.exerciseId,
            repCount: input.repCount,
            mandatorySilenceAfterMs: 2500
          })
        );
      }
    }

    if (input.phase !== "holding" && nextState.holdCueProgress.scheduleId) {
      nextState = {
        ...nextState,
        holdCueProgress: {
          ...nextState.holdCueProgress,
          cancelledAtMs:
            nextState.holdCueProgress.completedAtMs === null ? input.nowMs : nextState.holdCueProgress.cancelledAtMs,
          completedAtMs:
            input.phase === "lowering" || input.phase === "complete"
              ? input.nowMs
              : nextState.holdCueProgress.completedAtMs
        }
      };
    }

    if (
      nextState.recoveryState.active &&
      input.phase === "complete" &&
      !nextState.recoveryState.successAcknowledged
    ) {
      intents.push(
        createVoiceIntent({
          id: `recovery-success-${input.repCount}`,
          kind: "encouragement",
          text: "Well done for holding it that time.",
          priority: 4,
          speakDuringPhases: ["complete", "ready"],
          nowMs: input.nowMs,
          exerciseId: input.exerciseId,
          repCount: input.repCount,
          isRecoveryRep: true,
          mandatorySilenceAfterMs: 5000
        })
      );

      nextState = {
        ...nextState,
        recoveryState: {
          ...nextState.recoveryState,
          successAcknowledged: true,
          active: false
        },
        lastCueWasEncouragement: true,
        lastCueWasCorrection: false,
        lastSpokenAtMs: input.nowMs,
        silenceUntilMs: input.nowMs + 5000
      };
    }

    return {
      nextState,
      intents
    };
  }
}