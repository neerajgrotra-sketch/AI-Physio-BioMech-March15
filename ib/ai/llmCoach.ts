import type { RehabState } from "@/lib/engine/rehabStateBuilder";
import { deriveCoachingIntent } from "@/lib/engine/coachingIntent";
import { buildHistory } from "@/lib/engine/historyTracker";

export type AiCoachingResult = {
  message: string | null;
  debug: any;
};

export async function generateCoaching(
  state: RehabState
): Promise<AiCoachingResult | null> {
  const requestedAt = Date.now();
  const history = buildHistory(state);
  const intent = deriveCoachingIntent(state, history);

  const debugBase = {
    requestedAt,
    requestEvent: state.event,
    requestExercise: state.exerciseName,
    requestIntent: intent,
    requestIssues: [...state.detectedIssues],
    history,
    httpOk: null,
    httpStatus: null,
    usedFallback: false,
    returnedMessage: null,
    promptPreview: null,
    model: null,
    error: null,
    openAiError: null
  };

  try {
    if (state.event === "idle") {
      return {
        message: null,
        debug: {
          ...debugBase,
          error: "Skipped AI call because event was idle."
        }
      };
    }

    const enrichedState = {
      ...state,
      intent,
      history
    };

    const response = await fetch("/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(enrichedState)
    });

    let data: any = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    const message = typeof data?.message === "string" ? data.message : null;

    return {
      message,
      debug: {
        ...debugBase,
        httpOk: response.ok,
        httpStatus: response.status,
        usedFallback: Boolean(data?.debug?.usedFallback),
        returnedMessage: message,
        promptPreview:
          typeof data?.debug?.promptPreview === "string"
            ? data.debug.promptPreview
            : null,
        model: typeof data?.debug?.model === "string" ? data.debug.model : null,
        error: !response.ok ? `Coach route returned HTTP ${response.status}.` : null,
        openAiError:
          typeof data?.debug?.openAiError === "string"
            ? data.debug.openAiError
            : null
      }
    };
  } catch (error) {
    return {
      message: null,
      debug: {
        ...debugBase,
        error: error instanceof Error ? error.message : "Unknown AI coaching error."
      }
    };
  }
}
