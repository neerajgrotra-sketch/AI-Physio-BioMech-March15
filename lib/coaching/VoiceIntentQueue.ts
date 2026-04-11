import type { MovementPhase, VoiceIntent, VoiceIntentPriority } from "./types";

type QueueConfig = {
  defaultSilenceAfterMs: number;
  maxQueueLength: number;
};

type SpeakingItem = {
  intent: VoiceIntent;
  startedAtMs: number;
};

export type VoiceQueueSnapshot = {
  queueLength: number;
  currentlySpeakingId: string | null;
  silenceUntilMs: number | null;
  queuedIntentIds: string[];
};

export type DequeueContext = {
  nowMs: number;
  phase: MovementPhase;
};

const DEFAULT_CONFIG: QueueConfig = {
  defaultSilenceAfterMs: 4500,
  maxQueueLength: 20
};

function priorityValue(priority: VoiceIntentPriority): number {
  return priority;
}

function isPhaseAllowed(intent: VoiceIntent, phase: MovementPhase): boolean {
  return intent.speakDuringPhases.includes(phase);
}

function isExpired(intent: VoiceIntent, nowMs: number): boolean {
  return nowMs > intent.createdAt + intent.expiresAfterMs;
}

export class VoiceIntentQueue {
  private queue: VoiceIntent[] = [];
  private current: SpeakingItem | null = null;
  private silenceUntilMs: number | null = null;
  private config: QueueConfig;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
  }

  enqueue(intent: VoiceIntent, context: DequeueContext): boolean {
    if (isExpired(intent, context.nowMs)) {
      return false;
    }

    if (!this.isIntentStillValid(intent, context)) {
      return false;
    }

    if (
      intent.interruption?.flushLowerPriorityQueue ||
      intent.priority >= 5
    ) {
      this.flushLowerPriorityThan(intent.priority);
    }

    if (
      this.current &&
      intent.interruption?.canInterruptCurrentSpeech &&
      priorityValue(intent.priority) > priorityValue(this.current.intent.priority)
    ) {
      this.stopCurrent(context.nowMs);
      this.queue.unshift(intent);
      this.trim();
      return true;
    }

    this.queue.push(intent);
    this.sortQueue();
    this.trim();
    return true;
  }

  enqueueMany(intents: VoiceIntent[], context: DequeueContext): number {
    let accepted = 0;

    for (const intent of intents) {
      if (this.enqueue(intent, context)) {
        accepted += 1;
      }
    }

    return accepted;
  }

  peekNextSpeakable(context: DequeueContext): VoiceIntent | null {
    this.pruneInvalid(context);

    if (this.current) return null;
    if (this.silenceUntilMs !== null && context.nowMs < this.silenceUntilMs) {
      return null;
    }

    return this.queue[0] ?? null;
  }

  dequeueNextSpeakable(context: DequeueContext): VoiceIntent | null {
    this.pruneInvalid(context);

    if (this.current) return null;
    if (this.silenceUntilMs !== null && context.nowMs < this.silenceUntilMs) {
      return null;
    }

    const next = this.queue.shift() ?? null;
    if (!next) return null;

    if (!this.isIntentStillValid(next, context)) {
      return null;
    }

    this.current = {
      intent: next,
      startedAtMs: context.nowMs
    };

    return next;
  }

  markSpeechStarted(intentId: string, nowMs: number): void {
    if (!this.current || this.current.intent.id !== intentId) {
      return;
    }

    this.current = {
      ...this.current,
      startedAtMs: nowMs
    };
  }

  markSpeechCompleted(intentId: string, nowMs: number): void {
    if (!this.current || this.current.intent.id !== intentId) {
      return;
    }

    const silenceMs =
      this.current.intent.timing?.mandatorySilenceAfterMs ??
      this.config.defaultSilenceAfterMs;

    this.current = null;
    this.silenceUntilMs = nowMs + silenceMs;
  }

  stopCurrent(nowMs: number): void {
    if (!this.current) return;

    const silenceMs =
      this.current.intent.timing?.mandatorySilenceAfterMs ??
      this.config.defaultSilenceAfterMs;

    this.current = null;
    this.silenceUntilMs = nowMs + Math.min(1200, silenceMs);
  }

  flush(): void {
    this.queue = [];
  }

  flushLowerPriorityThan(priority: VoiceIntentPriority): void {
    this.queue = this.queue.filter(
      (intent) => priorityValue(intent.priority) >= priorityValue(priority)
    );
  }

  flushAllExceptCritical(): void {
    this.queue = this.queue.filter((intent) => intent.priority >= 5);
  }

  cancelIfPhaseChanged(context: DequeueContext): void {
    this.queue = this.queue.filter((intent) => {
      if (!intent.cancelIfPhaseChanges) return true;
      return isPhaseAllowed(intent, context.phase);
    });

    if (
      this.current &&
      this.current.intent.cancelIfPhaseChanges &&
      !isPhaseAllowed(this.current.intent, context.phase)
    ) {
      this.stopCurrent(context.nowMs);
    }
  }

  onRepComplete(context: DequeueContext): void {
    this.queue = this.queue.filter((intent) => intent.priority >= 4);
    this.cancelIfPhaseChanged(context);
  }

  onEarlyDrop(context: DequeueContext): void {
    this.flushAllExceptCritical();
    this.cancelIfPhaseChanged(context);
  }

  getSnapshot(): VoiceQueueSnapshot {
    return {
      queueLength: this.queue.length,
      currentlySpeakingId: this.current?.intent.id ?? null,
      silenceUntilMs: this.silenceUntilMs,
      queuedIntentIds: this.queue.map((intent) => intent.id)
    };
  }

  private trim(): void {
    if (this.queue.length <= this.config.maxQueueLength) return;
    this.queue = this.queue.slice(0, this.config.maxQueueLength);
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const priorityDiff = priorityValue(b.priority) - priorityValue(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt - b.createdAt;
    });
  }

  private pruneInvalid(context: DequeueContext): void {
    this.queue = this.queue.filter((intent) => this.isIntentStillValid(intent, context));
  }

  private isIntentStillValid(intent: VoiceIntent, context: DequeueContext): boolean {
    if (isExpired(intent, context.nowMs)) return false;
    if (!isPhaseAllowed(intent, context.phase)) return false;

    try {
      return intent.validWhile();
    } catch {
      return false;
    }
  }
}