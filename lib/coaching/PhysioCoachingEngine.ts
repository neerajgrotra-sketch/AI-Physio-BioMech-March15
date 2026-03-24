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

  /**
   * While true, the coaching engine is muted and will not produce
   * hold cues, corrections, or encouragement.
   */
  calibrationActive?: boolean;

  /**
   * While true, the engine suppresses observations and voice generation
   * so the user has time to read/hear the intro.
   */
  exerciseIntroActive?: boolean;
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
  calibrationActive: boolean;
  exerciseIntroActive: boolean;
  suppressObservationsUntilMs: number | null;
};

const INTRO_SUPPRESSION_MS = 2200;

export class PhysioCoachingEngine {
  private observationBuffer: ObservationBuffer;
  private behaviourModel: PhysioBehaviourModel;
  private voiceQueue: VoiceIntentQueue;

  private behaviourState: PhysioBehaviourState | null = null;
  private currentSessionId: string | null = null;
  private currentExerciseId: string | null = null;

  private calibrationActive = false;
  private exerciseIntroActive = false;
  private suppressObservationsUntilMs: number | null = null;
  private lastRepCount = 0;

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
    this.calibrationActive = false;
    this.exerciseIntroActive = false;
    this.suppressObservationsUntilMs = null;
    this.lastRepCount = 0;
  }

  resetExercise(exerciseId?: string): void {
    this.observationBuffer = new ObservationBuffer();
    this.voiceQueue.flush();
    this.currentExerciseId = exerciseId ?? null;
    this.exerciseIntroActive = false;
    this.suppressObservationsUntilMs = null;
    this.lastRepCount = 0;

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

  setCalibrationActive(active: boolean): void {
    this.calibrationActive = active;
    if (active) {
      this.voiceQueue.flush();
      this.suppressObservationsUntilMs = null;
    }
  }

  setExerciseIntroActive(active: boolean, nowMs?: number): void {
    this.exerciseIntroActive = active;

    if (active) {
      this.voiceQueue.flush();
      this.suppressObservationsUntilMs =
        (nowMs ?? Date.now()) + INTRO_SUPPRESSION_MS;
      return;
    }

    if (this.suppressObservationsUntilMs !== null) {
      this.suppressObservationsUntilMs = Math.max(
        this.suppressObservationsUntilMs,
        (nowMs ?? Date.now()) + 600
      );
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

    if (typeof frame.calibrationActive === "boolean") {
      this.setCalibrationActive(frame.calibrationActive);
    }

    if (typeof frame.exerciseIntroActive === "boolean") {
      this.setExerciseIntroActive(frame.exerciseIntroActive, frame.timestampMs);
    }

    const emptyResult = (): PhysioCoachingTickResult => ({
      observations: [],
      intentsGenerated: [],
      nextSpeakableIntent: null,
      behaviourState:
        this.behaviourState ??
        this.behaviourModel.update(null, {
          sessionId: frame.sessionId,
          exerciseId: frame.exerciseId,
          phase: frame.phase,
          repCount: frame.repCount,
          holdElapsedMs: frame.holdElapsedMs,
          holdRequiredMs: frame.holdRequiredMs,
          observations: [],
          nowMs: frame.timestampMs
        }).nextState,
      queueSnapshot: this.voiceQueue.getSnapshot()
    });

    // Hard mute during framing calibration.
    if (this.calibrationActive) {
      this.voiceQueue.flush();
      this.lastRepCount = frame.repCount;
      return emptyResult();
    }

    // Let the intro breathe before any behaviour model output.
    if (
      this.exerciseIntroActive ||
      (this.suppressObservationsUntilMs !== null &&
        frame.timestampMs < this.suppressObservationsUntilMs)
    ) {
      this.voiceQueue.flush();
      this.lastRepCount = frame.repCount;
      return emptyResult();
    }

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

    // Clear stale lowering/hold text once a rep completes.
    const repJustCompleted = frame.repCount > this.lastRepCount;
    if (repJustCompleted || frame.phase === "complete") {
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

    this.lastRepCount = frame.repCount;

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
      queueSnapshot: this.voiceQueue.getSnapshot(),
      calibrationActive: this.calibrationActive,
      exerciseIntroActive: this.exerciseIntroActive,
      suppressObservationsUntilMs: this.suppressObservationsUntilMs
    };
  }
}
