import type { RehabState } from "@/lib/engine/rehabStateBuilder";

export type HistoryState = {
  lastIssues: string[];
  repeatedIssue?: string;
  repeatedIssueCount: number;
  dominantIssue?: string;
  trend: "improving" | "worsening" | "stable";
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  recentEvents: string[];
};

type TrackerBucket = {
  lastIssues: string[];
  issueCounts: Record<string, number>;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  recentEvents: string[];
};

const tracker = new Map<string, TrackerBucket>();

function getBucketKey(state: RehabState): string {
  return `${state.exerciseId}:${state.side}`;
}

function getOrCreateBucket(key: string): TrackerBucket {
  const existing = tracker.get(key);
  if (existing) return existing;

  const created: TrackerBucket = {
    lastIssues: [],
    issueCounts: {},
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
    recentEvents: []
  };

  tracker.set(key, created);
  return created;
}

function deriveTrend(
  previousIssues: string[],
  currentIssues: string[]
): "improving" | "worsening" | "stable" {
  if (currentIssues.length < previousIssues.length) return "improving";
  if (currentIssues.length > previousIssues.length) return "worsening";

  const previousSet = new Set(previousIssues);
  const currentSet = new Set(currentIssues);

  const same =
    previousSet.size === currentSet.size &&
    [...previousSet].every((issue) => currentSet.has(issue));

  return same ? "stable" : "stable";
}

function getDominantIssue(issueCounts: Record<string, number>): string | undefined {
  let dominantIssue: string | undefined;
  let maxCount = 0;

  for (const [issue, count] of Object.entries(issueCounts)) {
    if (count > maxCount) {
      dominantIssue = issue;
      maxCount = count;
    }
  }

  return dominantIssue;
}

export function resetHistoryTracker(): void {
  tracker.clear();
}

export function buildHistory(state: RehabState): HistoryState {
  const key = getBucketKey(state);
  const bucket = getOrCreateBucket(key);

  const currentIssues = [...state.detectedIssues];
  const repeatedIssue = currentIssues.find((issue) =>
    bucket.lastIssues.includes(issue)
  );

  if (state.event === "rep_complete") {
    bucket.consecutiveSuccesses += 1;
    bucket.consecutiveFailures = 0;
  } else if (state.event === "rep_failed") {
    bucket.consecutiveFailures += 1;
    bucket.consecutiveSuccesses = 0;
  }

  for (const issue of currentIssues) {
    bucket.issueCounts[issue] = (bucket.issueCounts[issue] ?? 0) + 1;
  }

  bucket.recentEvents = [...bucket.recentEvents, state.event].slice(-5);

  const repeatedIssueCount = repeatedIssue
    ? bucket.issueCounts[repeatedIssue] ?? 1
    : 0;

  const trend = deriveTrend(bucket.lastIssues, currentIssues);
  const dominantIssue = getDominantIssue(bucket.issueCounts);

  bucket.lastIssues = currentIssues;

  return {
    lastIssues: currentIssues,
    repeatedIssue,
    repeatedIssueCount,
    dominantIssue,
    trend,
    consecutiveSuccesses: bucket.consecutiveSuccesses,
    consecutiveFailures: bucket.consecutiveFailures,
    recentEvents: bucket.recentEvents
  };
}
