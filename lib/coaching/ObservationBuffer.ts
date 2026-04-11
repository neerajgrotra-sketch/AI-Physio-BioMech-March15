import type { Observation, ObservationPattern, ObservationTrend, MovementPhase } from "./types";

type InterpreterSnapshot = {
  timestampMs: number;
  phase: MovementPhase;
  repCount: number;
  holdElapsedMs: number | null;
  holdRequiredMs: number | null;
  detectedIssues: string[];
  primaryIssue: string;
  armElevation?: number | null;
};

type BufferConfig = {
  windowMs: number;
  minDurationMs: number;
  minConfidence: number;
};

const DEFAULT_CONFIG: BufferConfig = {
  windowMs: 2500,
  minDurationMs: 800,
  minConfidence: 0.6
};

type PatternAccumulator = {
  count: number;
  firstSeen: number;
  lastSeen: number;
  reps: Set<number>;
};

export class ObservationBuffer {
  private history: InterpreterSnapshot[] = [];
  private config: BufferConfig;

  constructor(config?: Partial<BufferConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  add(snapshot: InterpreterSnapshot): Observation[] {
    this.history.push(snapshot);
    this.prune(snapshot.timestampMs);

    return this.computeObservations();
  }

  private prune(now: number) {
    const cutoff = now - this.config.windowMs;
    this.history = this.history.filter(h => h.timestampMs >= cutoff);
  }

  private computeObservations(): Observation[] {
    if (this.history.length < 3) return [];

    const patterns: Record<string, PatternAccumulator> = {};

    for (const frame of this.history) {
      const derived = this.derivePatterns(frame);

      for (const p of derived) {
        if (!patterns[p]) {
          patterns[p] = {
            count: 0,
            firstSeen: frame.timestampMs,
            lastSeen: frame.timestampMs,
            reps: new Set()
          };
        }

        patterns[p].count += 1;
        patterns[p].lastSeen = frame.timestampMs;
        patterns[p].reps.add(frame.repCount);
      }
    }

    const observations: Observation[] = [];

    for (const [patternKey, acc] of Object.entries(patterns)) {
      const duration = acc.lastSeen - acc.firstSeen;
      const confidence = acc.count / this.history.length;

      if (
        duration < this.config.minDurationMs ||
        confidence < this.config.minConfidence
      ) {
        continue;
      }

      const pattern = patternKey as ObservationPattern;

      observations.push({
        id: `${pattern}-${acc.firstSeen}`,
        pattern,
        confidence,
        repsSeen: acc.reps.size,
        trend: this.computeTrend(pattern),
        affectedSide: this.inferSide(pattern),
        firstSeenAtMs: acc.firstSeen,
        lastSeenAtMs: acc.lastSeen,
        emittedAtMs: Date.now(),
        exerciseId: "unknown",
        repRange: {
          firstRep: Math.min(...acc.reps),
          lastRep: Math.max(...acc.reps)
        },
        supportingPhases: this.getSupportingPhases(pattern),
        sourceIssueKeys: [pattern]
      });
    }

    return observations;
  }

  private derivePatterns(frame: InterpreterSnapshot): ObservationPattern[] {
    const patterns: ObservationPattern[] = [];

    // EARLY DROP
    if (
      frame.holdElapsedMs !== null &&
      frame.holdRequiredMs !== null &&
      frame.phase === "lowering" &&
      frame.holdElapsedMs < frame.holdRequiredMs * 0.8
    ) {
      patterns.push("early_drop");
    }

    // INSUFFICIENT RANGE
    if (
      frame.detectedIssues.includes("insufficient_range") ||
      frame.primaryIssue === "insufficient_range"
    ) {
      patterns.push("insufficient_range");
    }

    // UNSTABLE HOLD
    if (
      frame.phase === "holding" &&
      frame.detectedIssues.includes("unstable")
    ) {
      patterns.push("unstable_hold");
    }

    // STOPPED MOVING
    if (
      frame.phase === "ready" &&
      frame.repCount === 0 &&
      this.history.length > 10
    ) {
      patterns.push("stopped_moving");
    }

    return patterns;
  }

  private computeTrend(pattern: ObservationPattern): ObservationTrend {
    // simple heuristic: compare early vs late frequency
    const midpoint = Math.floor(this.history.length / 2);

    const firstHalf = this.history.slice(0, midpoint);
    const secondHalf = this.history.slice(midpoint);

    const count = (frames: InterpreterSnapshot[]) =>
      frames.filter(f => this.derivePatterns(f).includes(pattern)).length;

    const first = count(firstHalf);
    const second = count(secondHalf);

    if (second > first) return "worsening";
    if (second < first) return "improving";
    return "stable";
  }

  private inferSide(pattern: ObservationPattern) {
    if (pattern.includes("left")) return "left";
    if (pattern.includes("right")) return "right";
    return "unknown";
  }

  private getSupportingPhases(pattern: ObservationPattern): MovementPhase[] {
    switch (pattern) {
      case "early_drop":
        return ["holding", "lowering"];
      case "insufficient_range":
        return ["lifting"];
      case "unstable_hold":
        return ["holding"];
      case "stopped_moving":
        return ["ready"];
      default:
        return ["unknown"];
    }
  }
}