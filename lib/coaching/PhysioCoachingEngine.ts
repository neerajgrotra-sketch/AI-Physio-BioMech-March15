import { ObservationBuffer } from "./ObservationBuffer";
import { PhysioBehaviourModel } from "./PhysioBehaviourModel";
import { VoiceIntentQueue, type VoiceQueueSnapshot } from "./VoiceIntentQueue";

import type {
  MovementPhase,
  Observation,
  PhysioBehaviourState,
  VoiceIntent
} from "./types";

export type PhysioCoachingInterpreterFrame = {
  timestampMs: number;
  sessionId: string;
  exerciseId: string;
  phase: MovementPhase;
  repCount: number;
  holdElapsedMs: number | null;
  holdRequiredMs: number | null;
  detectedIssues: string[];
  primaryIssue: string;
  armElevation?: number | null;
};

export type PhysioCoachingTickResult = {
  observations: Observation[];
  intentsGenerated: VoiceIntent[];
  nextSpeakableIntent: VoiceIntent | null;
  behaviourState: PhysioBehaviourState;
  queueSnapshot: VoiceQueueSnapshot;
};

export type PhysioCoachingEngineSnapshot = {
  behaviourState: PhysioBehaviourState | null;
  queueSnapshot: VoiceQueueSnapshot;
};

export class PhysioCoachingEngine {
  private observationBuffer: ObservationBuffer;
  private behaviourModel: PhysioBehaviourModel;
  private voiceQueue: VoiceIntentQueue;

  private behaviourState: PhysioBehaviourState | null = null;
  private currentSessionId: string | null = null;
  private currentExerciseId: string | null = null;

  constructor() {
    this.observationBuffer = new ObservationBuffer();
    this.behaviourModel = new PhysioBehaviourModel();
    this.voiceQueue = new VoiceIntentQueue();
  }

  resetSession(sessionId?: string): void {
    this.observationBuffer = new ObservationBuffer();
    this.behaviourModel = new PhysioBehaviourModel();
    this.voiceQueue = new VoiceIntentQueue();
    this.behaviourState = null;
    this.currentSessionId = sessionId ?? null;
    this.currentExerciseId = null;
  }

  resetExercise(exerciseId?: string): void {
    this.observationBuffer = new ObservationBuffer();
    this.voiceQueue.flush();
    this.currentExerciseId = exerciseId ?? null;

    if (this.behaviourState) {
      this.behaviourState = {
        ...this.behaviourState,
        exerciseId: exerciseId ?? null,
        currentRepCount: 0,
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
  }

  tick(frame: PhysioCoachingInterpreterFrame): PhysioCoachingTickResult {
    if (!this.currentSessionId || this.currentSessionId !== frame.sessionId) {
      this.resetSession(frame.sessionId);
    }

    if (!this.currentExerciseId || this.currentExerciseId !== frame.exerciseId) {
      this.resetExercise(frame.exerciseId);
    }

    this.currentSessionId = frame.sessionId;
    this.currentExerciseId = frame.exerciseId;

    const observations = this.observationBuffer.add({
      timestampMs: frame.timestampMs,
      phase: frame.phase,
      repCount: frame.repCount,
      holdElapsedMs: frame.holdElapsedMs,
      holdRequiredMs: frame.holdRequiredMs,
      detectedIssues: frame.detectedIssues,
      primaryIssue: frame.primaryIssue,
      armElevation: frame.armElevation
    });

    const behaviour = this.behaviourModel.update(this.behaviourState, {
      sessionId: frame.sessionId,
      exerciseId: frame.exerciseId,
      phase: frame.phase,
      repCount: frame.repCount,
      holdElapsedMs: frame.holdElapsedMs,
      holdRequiredMs: frame.holdRequiredMs,
      observations,
      nowMs: frame.timestampMs
    });

    this.behaviourState = behaviour.nextState;

    this.voiceQueue.cancelIfPhaseChanged({
      nowMs: frame.timestampMs,
      phase: frame.phase
    });

    const hasEarlyDrop = observations.some((o) => o.pattern === "early_drop");
    if (hasEarlyDrop) {
      this.voiceQueue.onEarlyDrop({
        nowMs: frame.timestampMs,
        phase: frame.phase
      });
    }

    if (frame.phase === "complete") {
      this.voiceQueue.onRepComplete({
        nowMs: frame.timestampMs,
        phase: frame.phase
      });
    }

    this.voiceQueue.enqueueMany(behaviour.intents, {
      nowMs: frame.timestampMs,
      phase: frame.phase
    });

    const nextSpeakableIntent = this.voiceQueue.dequeueNextSpeakable({
      nowMs: frame.timestampMs,
      phase: frame.phase
    });

    return {
      observations,
      intentsGenerated: behaviour.intents,
      nextSpeakableIntent,
      behaviourState: this.behaviourState,
      queueSnapshot: this.voiceQueue.getSnapshot()
    };
  }

  markSpeechStarted(intentId: string, nowMs: number): void {
    this.voiceQueue.markSpeechStarted(intentId, nowMs);
  }

  markSpeechCompleted(intentId: string, nowMs: number): void {
    this.voiceQueue.markSpeechCompleted(intentId, nowMs);
  }

  interruptSpeech(nowMs: number): void {
    this.voiceQueue.stopCurrent(nowMs);
  }

  flushVoiceQueue(): void {
    this.voiceQueue.flush();
  }

  getSnapshot(): PhysioCoachingEngineSnapshot {
    return {
      behaviourState: this.behaviourState,
      queueSnapshot: this.voiceQueue.getSnapshot()
    };
  }
}
