import type { CoachingDecision } from "@/lib/types/coaching";
import type { InterpreterOutput } from "@/lib/interpreter/movementInterpreter";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { RehabEvent } from "@/lib/engine/rehabStateBuilder";
import { buildCoachingDecision } from "@/lib/coaching/coachingPolicy";

export type CoachingTrigger =
  | "none"
  | "deterministic"
  | "ai"
  | "countdown";

export type CoachingOrchestratorInput = {
  event: RehabEvent;
  output: InterpreterOutput;
  prescription: ExercisePrescription;
  previousPhase: string;
  currentPhase: string;
  nowMs: number;
  lastSpokenAtMs: number;
  aiEnabled: boolean;
};

export type CoachingOrchestratorResult = {
  shouldUpdatePanel: boolean;
  shouldSpeak: boolean;
  trigger: CoachingTrigger;
  decision: CoachingDecision;
  stickyMs: number;
};

const SPEECH_COOLDOWN_MS = 1800;

function buildCountdownDecision(holdRemainingMs: number): CoachingDecision {
  const seconds = Math.max(1, Math.ceil(holdRemainingMs / 1000));
  return {
    code: "keep_holding",
    priority: "info",
    message: `Hold ${seconds}`
  };
}

function isPhaseTransitionUseful(
  previousPhase: string,
  currentPhase: string
): boolean {
  if (previousPhase === currentPhase) return false;

  return (
    currentPhase === "lifting" ||
    currentPhase === "holding" ||
    currentPhase === "lowering" ||
    currentPhase === "ready" ||
    currentPhase === "complete"
  );
}

function shouldRespectCooldown(
  event: RehabEvent,
  nowMs: number,
  lastSpokenAtMs: number
): boolean {
  if (
    event === "rep_complete" ||
    event === "rep_failed" ||
    event === "exercise_complete"
  ) {
    return false;
  }

  return nowMs - lastSpokenAtMs < SPEECH_COOLDOWN_MS;
}

export function buildCoachingOrchestration(
  input: CoachingOrchestratorInput
): CoachingOrchestratorResult {
  const {
    event,
    output,
    prescription,
    previousPhase,
    currentPhase,
    nowMs,
    lastSpokenAtMs,
    aiEnabled
  } = input;

  const deterministic = buildCoachingDecision(output, prescription);
  const cooldownActive = shouldRespectCooldown(event, nowMs, lastSpokenAtMs);
  const usefulPhaseChange = isPhaseTransitionUseful(previousPhase, currentPhase);

  if (event === "rep_failed") {
    return {
      shouldUpdatePanel: true,
      shouldSpeak: true,
      trigger: aiEnabled ? "ai" : "deterministic",
      decision: {
        ...deterministic,
        message: `${deterministic.message} Pause and reset before trying again.`
      },
      stickyMs: 2800
    };
  }

  if (event === "rep_complete") {
    return {
      shouldUpdatePanel: true,
      shouldSpeak: true,
      trigger: aiEnabled ? "ai" : "deterministic",
      decision: {
        code: "good_rep",
        priority: "encourage",
        message: `${prescription.coaching.success} Again when ready.`
      },
      stickyMs: 1800
    };
  }

  if (event === "exercise_complete") {
    return {
      shouldUpdatePanel: true,
      shouldSpeak: true,
      trigger: aiEnabled ? "ai" : "deterministic",
      decision: {
        code: "exercise_complete",
        priority: "encourage",
        message: deterministic.message
      },
      stickyMs: 2600
    };
  }

  if (event === "start") {
    return {
      shouldUpdatePanel: true,
      shouldSpeak: !cooldownActive,
      trigger: aiEnabled ? "ai" : "deterministic",
      decision: deterministic,
      stickyMs: 2400
    };
  }

  if (output.holdRemainingMs !== null && !usefulPhaseChange) {
    return {
      shouldUpdatePanel: true,
      shouldSpeak: false,
      trigger: "countdown",
      decision: buildCountdownDecision(output.holdRemainingMs),
      stickyMs: 0
    };
  }

  if (usefulPhaseChange) {
    return {
      shouldUpdatePanel: true,
      shouldSpeak: !cooldownActive,
      trigger: "deterministic",
      decision: deterministic,
      stickyMs: currentPhase === "holding" ? 1400 : 1200
    };
  }

  return {
    shouldUpdatePanel: false,
    shouldSpeak: false,
    trigger: "none",
    decision: deterministic,
    stickyMs: 0
  };
}
