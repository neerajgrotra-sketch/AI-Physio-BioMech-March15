// ============================================================
// lib/coaching/useCoachingBrain.ts
// Version: module-2-v1 (immediate rep cues + hesitation fix)
// ============================================================
// AI coaching brain — clean rewrite.
//
// Key design decisions:
//
// 1. ONE API CALL AT A TIME
//    A single pendingCallRef tracks the active call.
//    New triggers cancel lower-priority pending calls.
//    Higher-priority triggers (rep_failed) always fire.
//
// 2. HOLD CUES ARE DETERMINISTIC
//    Hold phase cues come from prescription.coaching strings,
//    not from Claude. This eliminates the hold/rep_failed race
//    where both fired within milliseconds of each other.
//
// 3. PHASE-CHANGE CLEARING
//    When phase changes, the coaching panel clears immediately.
//    No stale "Hold at the top" persisting into lowering phase.
//
// 4. ALWAYS SPEAK ON REP COMPLETE
//    Claude is instructed to always return a brief cue after
//    a rep, even if it is just "Good." Silence is only allowed
//    for observation triggers.
//
// 5. TRIGGER PRIORITY
//    rep_failed (5) > rep_completed (4) > exercise_started (3)
//    > hesitation_detected (2) > observation_ready (1)
//    Lower-priority calls are dropped if a higher one is queued.
//
// 6. RATE LIMITING
//    Separate clocks for coaching vs framing.
//    Minimum 5s between coaching calls except rep_failed
//    which always fires.
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
  parseCoachingResponse
} from "@/lib/coaching/coachingPromptBuilder";

import type { PatientProfile, ExerciseSessionContext } from "@/lib/patient/patientTypes";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { Observation } from "@/lib/coaching/types";
import { recordMessage } from "@/lib/debug/movementTimeline";

// ============================================================
// CONSTANTS
// ============================================================

const API_TIMEOUT_MS = 5000;
const HESITATION_THRESHOLD_MS = 12000;
const MIN_COACHING_INTERVAL_MS = 3000;
const MIN_OBSERVATION_INTERVAL_MS = 15000;

// Priority values — higher number = higher priority
const TRIGGER_PRIORITY: Record<CoachingTrigger, number> = {
  rep_failed:        5,
  exercise_completing: 4,
  rep_completed:     4,
  exercise_started:  3,
  hold_started:      2,
  hesitation_detected: 2,
  observation_ready: 1
};

// ============================================================
// VOICE SYNTHESIS
// ============================================================
// Browser speech synthesis for spoken coaching cues.
// Speaks the coaching message when it is set.
// Respects a minimum silence window between utterances.
// Automatically cancelled when a new message arrives.
// ============================================================

let activeSpeechUtterance: SpeechSynthesisUtterance | null = null;

function speakMessage(text: string, rate = 0.95, pitch = 1.0) {
  if (typeof window === "undefined") return;
  if (!window.speechSynthesis) return;

  // Cancel any current speech
  window.speechSynthesis.cancel();
  activeSpeechUtterance = null;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = 1.0;

  // Prefer a natural English voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    v => v.lang.startsWith("en") && (
      v.name.includes("Natural") ||
      v.name.includes("Neural") ||
      v.name.includes("Premium") ||
      v.name.includes("Samantha") ||
      v.name.includes("Karen") ||
      v.name.includes("Daniel")
    )
  );
  if (preferred) utterance.voice = preferred;

  activeSpeechUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function cancelSpeech() {
  if (typeof window === "undefined") return;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  activeSpeechUtterance = null;
}

// ============================================================
// REP COMPLETION CUES
// ============================================================
// Immediate deterministic spoken acknowledgement the moment
// a rep completes. No API call — fires within 50ms.
// Rotates through short phrases so it does not feel robotic.
// Special cues for first rep, halfway, and final rep.
// ============================================================

const REP_CUES_GENERAL = [
  "Good.",
  "That's it.",
  "Nice.",
  "Well done.",
  "Good rep.",
];

function getImmediateRepCue(
  repNumber: number,   // 0-indexed rep just completed
  repTarget: number,
  failedRepCount: number
): string {
  const completedCount = repNumber + 1; // 1-indexed for display

  // First rep
  if (repNumber === 0) {
    return failedRepCount > 0
      ? "Good — that one counted."
      : "Good form on the first one.";
  }

  // Final rep
  if (completedCount === repTarget) {
    return "That's all of them. Well done.";
  }

  // Halfway milestone
  if (repTarget >= 4 && completedCount === Math.floor(repTarget / 2)) {
    return "Halfway there.";
  }

  // Second to last
  if (completedCount === repTarget - 1) {
    return "One more.";
  }

  // Rotate through general cues based on rep number
  return REP_CUES_GENERAL[repNumber % REP_CUES_GENERAL.length];
}

// ============================================================
// COACHING PANEL STATE
// ============================================================

export type CoachingPanelState = {
  message: string | null;
  tone: "encouraging" | "corrective" | "neutral" | "urgent";
  isThinking: boolean;
  source: "ai" | "fallback" | "deterministic" | "idle";
  setAtMs: number;
};

function createIdleState(): CoachingPanelState {
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
  // Observation buffer
  const observationBufferRef = useRef(new ObservationBuffer());

  // Silence gate
  const silenceGateRef = useRef<SilenceGateState>(createSilenceGateState());

  // Active call tracking
  const activeCallIdRef = useRef<string | null>(null);
  const activePriorityRef = useRef<number>(0);

  // Rate limiting — separate from framing
  const lastCoachingCallAtMsRef = useRef<number>(0);
  const lastObservationCallAtMsRef = useRef<number>(0);

  // Hesitation tracking
  const lastRepCompletedAtMsRef = useRef<number | null>(null);
  const hesitationFiredRef = useRef(false);

  // Phase tracking for clearing
  const lastPhaseFedRef = useRef<string>("ready");

  // Track rep count for immediate completion cues
  const repCountAtLastCompletionRef = useRef<number>(0);

  // Track when exercise started to protect intro speech
  const exerciseStartedAtMsRef = useRef<number>(0);

  // Phase at the time each call was triggered
  // Used to expire responses that arrive after phase has changed
  const phaseAtCallRef = useRef<string>("ready");

  // Voice enabled state
  const voiceEnabledRef = useRef<boolean>(true);

  // Timeout handle
  const timeoutHandleRef = useRef<number | null>(null);

  // Panel state
  const [panelState, setPanelState] = useState<CoachingPanelState>(createIdleState());

  // ----------------------------------------------------------
  // RESET
  // ----------------------------------------------------------

  const reset = useCallback(() => {
    observationBufferRef.current = new ObservationBuffer();
    silenceGateRef.current = createSilenceGateState();
    activeCallIdRef.current = null;
    activePriorityRef.current = 0;
    lastCoachingCallAtMsRef.current = 0;
    lastObservationCallAtMsRef.current = 0;
    lastRepCompletedAtMsRef.current = null;
    hesitationFiredRef.current = false;
    lastPhaseFedRef.current = "ready";

    if (timeoutHandleRef.current !== null) {
      window.clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }

    cancelSpeech();
    setPanelState(createIdleState());
  }, []);

  // ----------------------------------------------------------
  // CLEAR PANEL
  // Called when phase changes to avoid stale messages
  // ----------------------------------------------------------

  const clearPanel = useCallback(() => {
    setPanelState(createIdleState());
  }, []);

  // ----------------------------------------------------------
  // CALL CLAUDE
  // Async — never blocks frame loop.
  // ----------------------------------------------------------

  const callClaude = useCallback(async (params: {
    callId: string;
    prompt: string;
    fallbackText: string | null;
    trigger: CoachingTrigger;
    nowMs: number;
    phaseAtTrigger: string;
  }) => {
    const { callId, prompt, fallbackText, trigger, nowMs, phaseAtTrigger } = params;

    // Show thinking indicator only for important triggers
    if (trigger === "rep_failed" || trigger === "exercise_started") {
      setPanelState(prev => ({ ...prev, isThinking: true }));
    }

    // Set up timeout
    if (timeoutHandleRef.current !== null) {
      window.clearTimeout(timeoutHandleRef.current);
    }

    timeoutHandleRef.current = window.setTimeout(() => {
      if (activeCallIdRef.current !== callId) return;

      activeCallIdRef.current = null;
      activePriorityRef.current = 0;
      timeoutHandleRef.current = null;

      if (fallbackText) {
        const fbMs = Date.now();
        recordMessage({ source: "fallback", trigger, text: fallbackText, tone: "neutral", nowMs: fbMs });
        setPanelState({ message: fallbackText, tone: "neutral", isThinking: false, source: "fallback", setAtMs: fbMs });
      } else {
        setPanelState(prev => ({ ...prev, isThinking: false }));
      }
    }, API_TIMEOUT_MS);

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system:
            "You are a physiotherapy coaching assistant. You make coaching decisions during live exercise sessions. Always respond with valid JSON only. Be concise — coaching cues must be short."
        })
      });

      // Clear timeout
      if (timeoutHandleRef.current !== null) {
        window.clearTimeout(timeoutHandleRef.current);
        timeoutHandleRef.current = null;
      }

      // Check if still current
      if (activeCallIdRef.current !== callId) return;

      activeCallIdRef.current = null;
      activePriorityRef.current = 0;

      if (!response.ok) throw new Error("API " + response.status);

      const data = await response.json();
      const rawText = data.text ?? "";
      const parsed = parseCoachingResponse(rawText);

      if (!parsed || !parsed.speak || !parsed.text) {
        // Claude chose not to speak — clear thinking indicator
        setPanelState(prev => ({ ...prev, isThinking: false }));
        return;
      }

      // Expire response if it arrived too late to be contextually relevant.
      // Different triggers have different expiry rules.
      const currentPhase = lastPhaseFedRef.current;
      const isPhaseIndependent =
        trigger === "exercise_started" ||
        trigger === "exercise_completing" ||
        trigger === "rep_failed";

      // Active movement phases — patient is mid-rep
      const activeMovementPhases = ["lifting", "top", "holding"];

      let isExpired = false;

      if (!isPhaseIndependent) {
        if (trigger === "rep_completed") {
          // rep_completed: expire only if patient is actively holding again
          // 'lifting' (0.3-0.5s) and 'top' (instant) are brief enough that
          // feedback arriving then is still contextually relevant
          // Only expire when clearly into the next hold
          isExpired = currentPhase === "holding";
        } else if (trigger === "hold_started") {
          // hold_started: expire if no longer holding
          isExpired = currentPhase !== "holding";
        } else if (trigger === "hesitation_detected") {
          // hesitation: expire if patient has started moving
          isExpired = currentPhase !== "ready";
        } else {
          // Default: expire if phase changed at all
          isExpired = currentPhase !== phaseAtTrigger;
        }
      }

      if (isExpired) {
        recordMessage({
          source: "ai",
          trigger: trigger + "_EXPIRED",
          text: parsed.text + " [expired]",
          tone: "neutral",
          nowMs: Date.now()
        });
        setPanelState(prev => ({ ...prev, isThinking: false }));
        return;
      }

      // Update silence gate
      silenceGateRef.current = updateSilenceGate(
        silenceGateRef.current,
        trigger,
        nowMs
      );

      const setAtMs = Date.now();
      recordMessage({
        source: "ai",
        trigger,
        text: parsed.text,
        tone: parsed.tone,
        nowMs: setAtMs
      });

      // Speak the message if voice is enabled
      if (voiceEnabledRef.current) {
        // Slightly slower for corrective tone, normal for encouraging
        const rate = parsed.tone === "corrective" ? 0.88 : 0.95;
        speakMessage(parsed.text, rate);
      }

      setPanelState({
        message: parsed.text,
        tone: parsed.tone,
        isThinking: false,
        source: "ai",
        setAtMs
      });
    } catch {
      if (timeoutHandleRef.current !== null) {
        window.clearTimeout(timeoutHandleRef.current);
        timeoutHandleRef.current = null;
      }

      if (activeCallIdRef.current !== callId) return;
      activeCallIdRef.current = null;
      activePriorityRef.current = 0;

      if (fallbackText) {
        setPanelState({
          message: fallbackText,
          tone: "neutral",
          isThinking: false,
          source: "fallback",
          setAtMs: Date.now()
        });
      } else {
        setPanelState(prev => ({ ...prev, isThinking: false }));
      }
    }
  }, []);

  // ----------------------------------------------------------
  // TRIGGER COACHING DECISION
  // Core gate — decides whether to call Claude
  // ----------------------------------------------------------

  const triggerCoachingDecision = useCallback((params: {
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

    const priority = TRIGGER_PRIORITY[trigger];

    // Drop lower-priority calls if a higher one is in flight
    if (
      activeCallIdRef.current !== null &&
      priority < activePriorityRef.current
    ) {
      return;
    }

    // Silence gate — rep_failed and exercise_started always bypass
    const bypassSilence =
      trigger === "rep_failed" ||
      trigger === "exercise_started" ||
      trigger === "exercise_completing";

    if (
      !bypassSilence &&
      isSilenceWindowActive(silenceGateRef.current, nowMs)
    ) {
      return;
    }

    // Rate limit — rep_failed and exercise_started always bypass
    const bypassRateLimit =
      trigger === "rep_failed" ||
      trigger === "exercise_started" ||
      trigger === "exercise_completing";

    if (
      !bypassRateLimit &&
      nowMs - lastCoachingCallAtMsRef.current < MIN_COACHING_INTERVAL_MS
    ) {
      return;
    }

    // Build context and prompt
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

    const prompt = buildCoachingPrompt(clinicalContext);
    const fallbackText = getFallbackText(trigger, prescription, failureReason);

    const callId = trigger + "-" + nowMs;
    // Only cancel previous call if new trigger has strictly higher priority
    // This allows previous responses to still arrive and display
    // unless something more important superseded them
    if (priority >= activePriorityRef.current) {
      activeCallIdRef.current = callId;
      activePriorityRef.current = priority;
    }
    lastCoachingCallAtMsRef.current = nowMs;
    phaseAtCallRef.current = lastPhaseFedRef.current;

    callClaude({ callId, prompt, fallbackText, trigger, nowMs, phaseAtTrigger: phaseAtCallRef.current });
  }, [callClaude]);

  // ----------------------------------------------------------
  // FEED FRAME
  // Called every frame — feeds observation buffer,
  // detects phase changes, detects hesitation
  // ----------------------------------------------------------

  const feedFrame = useCallback((params: {
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

    const prevPhase = lastPhaseFedRef.current;

    // Phase transition handling
    if (prevPhase !== phase) {
      const staleOnChange =
        (prevPhase === "holding" && phase === "lowering") ||
        (prevPhase === "lowering" && phase === "ready") ||
        (prevPhase === "ready" && phase === "lifting");

      if (staleOnChange) {
        clearPanel();
      }

      // Deterministic voice cue: hold complete → lower
      // Only fire if hold was satisfied (not an early drop)
      if (prevPhase === "holding" && phase === "lowering") {
        if (voiceEnabledRef.current) {
          setTimeout(() => speakMessage("Lower slowly.", 0.88), 100);
        }
      }
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

    // Observation-triggered coaching (heavily throttled)
    // Suppress until at least 1 rep has been attempted to avoid
    // premature "stopped_moving" observations at exercise start
    if (
      observations.length > 0 &&
      repCount >= 1 &&
      !isSilenceWindowActive(silenceGateRef.current, nowMs) &&
      nowMs - lastObservationCallAtMsRef.current >= MIN_OBSERVATION_INTERVAL_MS &&
      activeCallIdRef.current === null
    ) {
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

    // Hesitation detection
    // Suppressed after exercise COMPLETE — patient is done,
    // hesitation prompts after completion are confusing
    const exerciseIsComplete = repCount >= prescription.repTarget ||
      phase === "complete";

    if (
      phase === "ready" &&
      !exerciseIsComplete &&
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

    // Reset hesitation when movement resumes
    if (phase !== "ready") {
      hesitationFiredRef.current = false;
    }
  }, [triggerCoachingDecision, clearPanel]);

  // ----------------------------------------------------------
  // EVENT HANDLERS
  // ----------------------------------------------------------

  const onRepCompleted = useCallback((params: {
    prescription: ExercisePrescription;
    patientProfile: PatientProfile;
    exerciseContext: ExerciseSessionContext;
    nowMs: number;
  }) => {
    lastRepCompletedAtMsRef.current = params.nowMs;
    hesitationFiredRef.current = false;

    // Check if this is the final rep — exercise_completing will handle the
    // summary, so skip the AI rep_completed call to avoid double messages
    const isFinalRep = params.exerciseContext.repCount + 1 >= params.prescription.repTarget;

    // IMMEDIATE deterministic rep completion cue
    // Fires within ~50ms — no API call
    const completedRepNumber = params.exerciseContext.repCount;
    const repTarget = params.prescription.repTarget;
    const failedReps = params.exerciseContext.failedReps;
    const immediateCue = getImmediateRepCue(
      completedRepNumber,
      repTarget,
      failedReps
    );

    // Show in panel immediately
    setPanelState({
      message: immediateCue,
      tone: "encouraging",
      isThinking: false,
      source: "deterministic",
      setAtMs: params.nowMs
    });

    // Speak immediately
    if (voiceEnabledRef.current) {
      speakMessage(immediateCue, 0.95);
    }

    repCountAtLastCompletionRef.current = completedRepNumber;

    // Fire AI for detailed follow-up coaching (arrives 2-3s later)
    // Skip on final rep — exercise_completing handles the summary instead
    if (!isFinalRep) {
      triggerCoachingDecision({
        trigger: "rep_completed",
        ...params
      });
    }
  }, [triggerCoachingDecision]);

  const onRepFailed = useCallback((params: {
    prescription: ExercisePrescription;
    patientProfile: PatientProfile;
    exerciseContext: ExerciseSessionContext;
    failureReason: string;
    nowMs: number;
  }) => {
    // Cancel any pending lower-priority call
    activeCallIdRef.current = null;
    activePriorityRef.current = 0;

    triggerCoachingDecision({
      trigger: "rep_failed",
      ...params
    });
  }, [triggerCoachingDecision]);

  const onHoldStarted = useCallback((params: {
    prescription: ExercisePrescription;
    patientProfile: PatientProfile;
    exerciseContext: ExerciseSessionContext;
    holdRequiredMs: number;
    nowMs: number;
  }) => {
    // Hold cues are DETERMINISTIC — no API call.
    // This eliminates the hold/rep_failed race condition.
    // The hold text comes directly from the prescription.
    const holdText = params.prescription.coaching.hold ?? "Hold it there.";
    const message = holdText;

    // Only show if not currently showing a more important message
    setPanelState(prev => {
      if (prev.source === "ai" && prev.tone === "corrective") return prev;
      const holdMs = Date.now();
      recordMessage({ source: "deterministic", trigger: "hold_started", text: message, tone: "neutral", nowMs: holdMs });

      // Speak hold cue if voice enabled
      // But don't interrupt if exercise intro was spoken recently (< 4s)
      // Queue it to play after current speech ends instead
      if (voiceEnabledRef.current) {
        const timeSinceExerciseStart = Date.now() - exerciseStartedAtMsRef.current;
        const introStillSpeaking = timeSinceExerciseStart < 4000;

        if (introStillSpeaking && window.speechSynthesis?.speaking) {
          // Queue hold cue to fire after current speech ends
          const checkAndSpeak = () => {
            if (!window.speechSynthesis.speaking) {
              speakMessage(message, 0.9);
            } else {
              setTimeout(checkAndSpeak, 200);
            }
          };
          setTimeout(checkAndSpeak, 200);
        } else {
          setTimeout(() => speakMessage(message, 0.9), 200);
        }
      }

      return {
        message,
        tone: "neutral",
        isThinking: false,
        source: "deterministic",
        setAtMs: holdMs
      };
    });
  }, []);

  const onExerciseStarted = useCallback((params: {
    prescription: ExercisePrescription;
    patientProfile: PatientProfile;
    exerciseContext: ExerciseSessionContext;
    nowMs: number;
  }) => {
    reset();
    repCountAtLastCompletionRef.current = 0;
    exerciseStartedAtMsRef.current = params.nowMs;
    triggerCoachingDecision({
      trigger: "exercise_started",
      ...params
    });
  }, [reset, triggerCoachingDecision]);

  const onExerciseCompleting = useCallback((params: {
    prescription: ExercisePrescription;
    patientProfile: PatientProfile;
    exerciseContext: ExerciseSessionContext;
    nowMs: number;
  }) => {
    triggerCoachingDecision({
      trigger: "exercise_completing",
      ...params
    });
  }, [triggerCoachingDecision]);

  // Voice toggle — exposed so SessionRunner can add a UI control
  const setVoiceEnabled = useCallback((enabled: boolean) => {
    voiceEnabledRef.current = enabled;
    if (!enabled) cancelSpeech();
  }, []);

  const isVoiceEnabled = () => voiceEnabledRef.current;

  return {
    panelState,
    feedFrame,
    onRepCompleted,
    onRepFailed,
    onHoldStarted,
    onExerciseStarted,
    onExerciseCompleting,
    reset,
    setVoiceEnabled,
    isVoiceEnabled
  };
}

// ============================================================
// FALLBACK TEXT
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

    case "exercise_started":
      return prescription.coaching.intro;

    case "exercise_completing":
      return "Well done — exercise complete.";

    case "hesitation_detected":
      return "Take your time — begin when ready.";

    case "hold_started":
      return prescription.coaching.hold;

    case "observation_ready":
      return null;

    default:
      return null;
  }
}
