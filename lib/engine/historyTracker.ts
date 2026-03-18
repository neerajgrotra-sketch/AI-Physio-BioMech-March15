import type { RehabState } from "@/lib/engine/rehabStateBuilder";

type HistoryState = {
  lastIssues: string[];
  repeatedIssue?: string;
  trend: "improving" | "worsening" | "stable";
};

let previousIssues: string[] = [];

export function buildHistory(state: RehabState): HistoryState {
  const currentIssues = state.detectedIssues;

  let repeatedIssue: string | undefined;

  for (const issue of currentIssues) {
    if (previousIssues.includes(issue)) {
      repeatedIssue = issue;
      break;
    }
  }

  let trend: "improving" | "worsening" | "stable" = "stable";

  if (currentIssues.length < previousIssues.length) {
    trend = "improving";
  } else if (currentIssues.length > previousIssues.length) {
    trend = "worsening";
  }

  previousIssues = currentIssues;

  return {
    lastIssues: currentIssues,
    repeatedIssue,
    trend
  };
}
