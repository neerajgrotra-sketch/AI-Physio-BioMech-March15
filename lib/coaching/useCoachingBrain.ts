// ============================================================
// lib/coaching/useCoachingBrain.ts
// ============================================================
// The AI coaching brain hook.
//
// This is what SessionRunner calls to get coaching decisions.
// It wires together:
// - ObservationBuffer (pattern detection)
// - ClinicalContextAssembler (builds AI prompt context)
// - CoachingPromptBuilder (builds the exact prompt)
// - Claude API (generates the coaching response)
// - Silence gate (prevents over-coaching)
// - Deterministic fallbacks (fires if Claude times out)
//
// SessionRunner reads:
// - coachingMessage: string | null  → display in coaching panel
// - coachingTone: string            → for visual styling
// - isThinking: boolean             → show subtle indicator
//
// SessionRunner calls:
// - onRepCompleted()   → after every successful rep
// - onRepFailed()      → after every failed rep
// - onHoldStarted()    → when hold phase begins
// - onHesitation()     → when patient stops between reps
// - onExerciseStarted() → before each exercise
// - onExerciseCompleting() → after final rep
// - feedFrame()        → every frame for observation buffer
// ============================================================

import { useRef, useState, useCallback } from "react";

import { ObservationBuffer } from "@/lib/coaching/ObservationBuffer";
import {
  assembleClinicalContext,
  createSilenceGateState,
  updateSilenceGate,
  isSilenceWindowActive,
  type CoachingTrigger,
  type SilenceGateState
} from "@/lib/coaching/clinicalContextAssembler";
import {
  buildCoachingPrompt,
  parseCoachingResponse,
  type CoachingResponse
} from "@/lib/coaching/coachingPromptBuilder";

import type { PatientProfile, ExerciseSessionContext } from "@/lib/patient/patientTypes";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { Observation } from "@/lib/coaching/types";

// ============================================================
// CONSTANTS
// ============================================================

const API_TIMEOUT_MS = 4000;
const HESITATION_THRESHOLD_MS = 12000;

// Hard rate limit guard — no matter what, API calls cannot
// fire faster than this interval. Keeps us well under 50 rpm.
const MIN_API_INTERVAL_MS = 5000;

// Observation triggers come from feedFrame (30fps) so need
// extra throttle on top of the silence gate.
const MIN_OBSERVATION_INTERVAL_MS = 12000;

// ============================================================
// COACHING PANEL STATE
// ============================================================
// What SessionRunner displays in the coaching panel.
// ============================================================

export type CoachingPanelState = {
  // Current message to display/speak
  message: string | null;

  // Visual tone for styling the panel
  tone: "encouraging" | "corrective" | "neutral" | "urgent";

  // Whether Claude is currently thinking
  isThinking: boolean;

  // Whether this message came from AI or deterministic fallback
  source: "ai" | "fallback" | "deterministic" | "idle";

  // Timestamp of when this message was set
  setAtMs: number;
};

function createIdlePanelState(): CoachingPanelState {
  return {
    message: null,
    tone: "neutral",
    isThinking: false,
    source: "idle",
    setAtMs: 0
  };
}

// ============================================================
// HOOK
// ============================================================

export function useCoachingBrain() {
  // Observation buffer — detects patterns across frames
  const observationBufferRef = useRef(new ObservationBuffer());

  // Silence gate — prevents over-coaching
  const silenceGateRef = useRef<SilenceGateState>(createSilenceGateState());

  // Pending API call tracking
  const pendingCallIdRef = useRef<string | null>(null);

  // Hesitation tracking
  const lastRepCompletedAtMsRef = useRef<number | null>(null);
  const hesitationFiredRef = useRef(false);

  // Track last phase to detect phase changes for message clearing
  const lastPhaseFedRef = useRef<string>("ready");

  // Rate limiting — separate clocks per trigger category.
  // Framing calls and coaching calls do not share a clock.
  // This prevents framing from blocking coaching and vice versa.
  const lastCoachingCallAtMsRef = useRef<number>(0);
  const lastObservationCallAtMsRef = useRef<number>(0);

  // UI state
  const [panelState, setPanelState] =
    useState<CoachingPanelState>(createIdlePanelState());

  // ----------------------------------------------------------
  // RESET
  // Call when exercise changes
  // ----------------------------------------------------------

  const reset = useCallback(() => {
    observationBufferRef.current = new ObservationBuffer();
    silenceGateRef.current = createSilenceGateState();
    pendingCallIdRef.current = null;
    lastRepCompletedAtMsRef.current = null;
    hesitationFiredRef.current = false;
    lastCoachingCallAtMsRef.current = 0;
    lastObservationCallAtMsRef.current = 0;
    lastPhaseFedRef.current = "ready";
    setPanelState(createIdlePanelState());
  }, []);

  // ----------------------------------------------------------
  // CLAUDE API CALL
  // Async — never blocks the frame loop.
  // Fires fallback immediately if timeout exceeded.
  // ----------------------------------------------------------

  const callClaude = useCallback(
    async (
      callId: string,
      prompt: string,
      fallbackText: string | null,
      trigger: CoachingTrigger,
      nowMs: number
    ) => {
      // Show thinking indicator
      setPanelState((prev) => ({
        ...prev,
        isThinking: true
      }));

      // Set up timeout — fires fallback if Claude is slow
      const timeoutHandle = window.setTimeout(() => {
        if (pendingCallIdRef.current !== callId) return;

        pendingCallIdRef.current = null;

        if (fallbackText) {
          setPanelState({
            message: fallbackText,
            tone: "neutral",
            isThinking: false,
            source: "fallback",
            setAtMs: Date.now()
          });
        } else {
          setPanelState((prev) => ({
            ...prev,
            isThinking: false
          }));
        }
      }, API_TIMEOUT_MS);

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            system:
              "You are a physiotherapy coaching assistant. You make coaching decisions during live exercise sessions. Always respond with valid JSON only. Be concise — coaching cues must be short.",
            messages: [{ role: "user", content: prompt }]
          })
        });

        window.clearTimeout(timeoutHandle);

        // Check if this call is still current
        if (pendingCallIdRef.current !== callId) return;
        pendingCallIdRef.current = null;

        if (!response.ok) throw new Error(`API ${response.status}`);

        const data = await response.json();
        const rawText = data.content
          ?.map((item: { type: string; text?: string }) =>
            item.type === "text" ? item.text ?? "" : ""
          )
          .join("");

        const parsed: CoachingResponse | null = parseCoachingResponse(rawText);

        if (!parsed || !parsed.speak || !parsed.text) {
          // AI decided not to speak
          setPanelState((prev) => ({
            ...prev,
            isThinking: false
          }));
          return;
        }

        // Update silence gate
        silenceGateRef.current = updateSilenceGate(
          silenceGateRef.current,
          trigger,
          nowMs
        );

        setPanelState({
          message: parsed.text,
          tone: parsed.tone,
          isThinking: false,
          source: "ai",
          setAtMs: Date.now()
        });
      } catch {
        window.clearTimeout(timeoutHandle);
        if (pendingCallIdRef.current !== callId) return;
        pendingCallIdRef.current = null;

        if (fallbackText) {
          setPanelState({
            message: fallbackText,
            tone: "neutral",
            isThinking: false,
            source: "fallback",
            setAtMs: Date.now()
          });
        } else {
          setPanelState((prev) => ({ ...prev, isThinking: false }));
        }
      }
    },
    []
  );

  // ----------------------------------------------------------
  // TRIGGER COACHING DECISION
  // Core function — assembles context and fires Claude call
  // ----------------------------------------------------------

  const triggerCoachingDecision = useCallback(
    (params: {
      trigger: CoachingTrigger;
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      failureReason?: string | null;
      observation?: Observation | null;
      holdElapsedMs?: number | null;
      holdRequiredMs?: number | null;
      nowMs: number;
    }) => {
      const {
        trigger,
        prescription,
        patientProfile,
        exerciseContext,
        failureReason = null,
        observation = null,
        holdElapsedMs = null,
        holdRequiredMs = null,
        nowMs
      } = params;

      // Check silence gate — never trigger if within silence window
      // Exception: rep_failed always gets through
      if (
        trigger !== "rep_failed" &&
        trigger !== "exercise_started" &&
        isSilenceWindowActive(silenceGateRef.current, nowMs)
      ) {
        return;
      }

      // Hard rate limit — coaching calls cannot fire faster than MIN_API_INTERVAL_MS.
      // exercise_started and rep_failed always bypass this to ensure they fire.
      if (
        trigger !== "exercise_started" &&
        trigger !== "rep_failed" &&
        nowMs - lastCoachingCallAtMsRef.current < MIN_API_INTERVAL_MS
      ) {
        return;
      }

      // Cancel any pending call
      const callId = `coaching-${trigger}-${nowMs}`;
      pendingCallIdRef.current = callId;

      // Assemble clinical context
      const clinicalContext = assembleClinicalContext({
        prescription,
        patientProfile,
        exerciseContext,
        trigger,
        failureReason,
        observation,
        holdElapsedMs,
        holdRequiredMs,
        nowMs
      });

      // Build prompt
      const prompt = buildCoachingPrompt(clinicalContext);

      // Get deterministic fallback from prescription coaching strings
      const fallbackText = getFallbackText(trigger, prescription, failureReason);

      // Record coaching call time for rate limiting
      lastCoachingCallAtMsRef.current = nowMs;

      // Fire async Claude call
      callClaude(callId, prompt, fallbackText, trigger, nowMs);
    },
    [callClaude]
  );

  // ----------------------------------------------------------
  // FEED FRAME
  // Called every frame from the inference loop.
  // Feeds the ObservationBuffer and checks for:
  // - New stable observations → trigger coaching
  // - Hesitation between reps → trigger coaching
  // ----------------------------------------------------------

  const feedFrame = useCallback(
    (params: {
      phase: string;
      repCount: number;
      holdElapsedMs: number | null;
      holdRequiredMs: number | null;
      primaryIssue: string;
      armElevation?: number | null;
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      nowMs: number;
    }) => {
      const {
        phase,
        repCount,
        holdElapsedMs,
        holdRequiredMs,
        primaryIssue,
        armElevation,
        prescription,
        patientProfile,
        exerciseContext,
        nowMs
      } = params;

      // Clear stale hold message when phase changes away from holding
      // This prevents "Hold at the top" persisting into the lowering phase
      if (lastPhaseFedRef.current === "holding" && phase !== "holding") {
        setPanelState((prev) => {
          // Only clear if the message is hold-related
          const holdMessages = ["hold", "Hold", "keep holding", "Keep holding", "keep it", "breathe"];
          const isHoldMessage = holdMessages.some(kw => (prev.message ?? "").toLowerCase().includes(kw.toLowerCase()));
          if (isHoldMessage || prev.source === "fallback") {
            return createIdlePanelState();
          }
          return prev;
        });
      }
      lastPhaseFedRef.current = phase;

      // Feed observation buffer
      const observations = observationBufferRef.current.add({
        timestampMs: nowMs,
        phase: phase as any,
        repCount,
        holdElapsedMs,
        holdRequiredMs,
        detectedIssues: primaryIssue !== "idle" ? [primaryIssue] : [],
        primaryIssue,
        armElevation
      });

      // Check for new stable observations
      // Extra throttle for observation triggers — they fire from feedFrame
      // so need stricter interval than the general MIN_API_INTERVAL_MS
      if (
        observations.length > 0 &&
        !isSilenceWindowActive(silenceGateRef.current, nowMs) &&
        nowMs - lastObservationCallAtMsRef.current >= MIN_OBSERVATION_INTERVAL_MS
      ) {
        // Use the highest-confidence observation
        const topObservation = observations.reduce((best, obs) =>
          obs.confidence > best.confidence ? obs : best
        );

        lastObservationCallAtMsRef.current = nowMs;
        triggerCoachingDecision({
          trigger: "observation_ready",
          prescription,
          patientProfile,
          exerciseContext,
          observation: topObservation,
          holdElapsedMs,
          holdRequiredMs,
          nowMs
        });
      }

      // Check for hesitation between reps
      if (
        phase === "ready" &&
        lastRepCompletedAtMsRef.current !== null &&
        !hesitationFiredRef.current
      ) {
        const hesitationMs = nowMs - lastRepCompletedAtMsRef.current;
        if (hesitationMs >= HESITATION_THRESHOLD_MS) {
          hesitationFiredRef.current = true;
          triggerCoachingDecision({
            trigger: "hesitation_detected",
            prescription,
            patientProfile,
            exerciseContext,
            nowMs
          });
        }
      }

      // Reset hesitation flag when movement resumes
      if (phase !== "ready") {
        hesitationFiredRef.current = false;
      }
    },
    [triggerCoachingDecision]
  );

  // ----------------------------------------------------------
  // EVENT HANDLERS
  // Called from SessionRunner at key moments
  // ----------------------------------------------------------

  const onRepCompleted = useCallback(
    (params: {
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      nowMs: number;
    }) => {
      lastRepCompletedAtMsRef.current = params.nowMs;
      hesitationFiredRef.current = false;

      triggerCoachingDecision({
        trigger: "rep_completed",
        ...params
      });
    },
    [triggerCoachingDecision]
  );

  const onRepFailed = useCallback(
    (params: {
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      failureReason: string;
      nowMs: number;
    }) => {
      triggerCoachingDecision({
        trigger: "rep_failed",
        ...params
      });
    },
    [triggerCoachingDecision]
  );

  const onHoldStarted = useCallback(
    (params: {
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      holdRequiredMs: number;
      nowMs: number;
    }) => {
      triggerCoachingDecision({
        trigger: "hold_started",
        holdElapsedMs: 0,
        ...params
      });
    },
    [triggerCoachingDecision]
  );

  const onExerciseStarted = useCallback(
    (params: {
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      nowMs: number;
    }) => {
      reset();
      triggerCoachingDecision({
        trigger: "exercise_started",
        ...params
      });
    },
    [reset, triggerCoachingDecision]
  );

  const onExerciseCompleting = useCallback(
    (params: {
      prescription: ExercisePrescription;
      patientProfile: PatientProfile;
      exerciseContext: ExerciseSessionContext;
      nowMs: number;
    }) => {
      triggerCoachingDecision({
        trigger: "exercise_completing",
        ...params
      });
    },
    [triggerCoachingDecision]
  );

  return {
    // UI state
    panelState,

    // Frame feed
    feedFrame,

    // Event handlers
    onRepCompleted,
    onRepFailed,
    onHoldStarted,
    onExerciseStarted,
    onExerciseCompleting,

    // Lifecycle
    reset
  };
}

// ============================================================
// FALLBACK TEXT BUILDER
// ============================================================
// Deterministic text used when Claude times out.
// Drawn from prescription coaching strings.
// ============================================================

function getFallbackText(
  trigger: CoachingTrigger,
  prescription: ExercisePrescription,
  failureReason: string | null
): string | null {
  switch (trigger) {
    case "rep_completed":
      return prescription.coaching.success;

    case "rep_failed":
      if (failureReason === "failed_height")
        return prescription.coaching.failedHeight;
      if (failureReason === "failed_hold")
        return prescription.coaching.failedHold;
      if (failureReason === "failed_balance")
        return prescription.coaching.failedBalance;
      if (failureReason === "failed_isolation")
        return prescription.coaching.failedIsolation ?? null;
      return prescription.coaching.failedHeight;

    case "hold_started":
      return prescription.coaching.hold;

    case "exercise_started":
      return prescription.coaching.intro;

    case "exercise_completing":
      return "Well done — exercise complete.";

    case "hesitation_detected":
      return "Take your time — begin the next movement when ready.";

    case "observation_ready":
      return null; // No fallback for observations — stay silent

    default:
      return null;
  }
}
