"use client";

import { useEffect, useRef } from "react";

type UseVoiceCoachingOptions = {
  enabled?: boolean;
  cooldownMs?: number;
  rate?: number;
  pitch?: number;
  volume?: number;
};

const DEFAULT_OPTIONS: Required<UseVoiceCoachingOptions> = {
  enabled: true,
  cooldownMs: 1800,
  rate: 0.92,
  pitch: 1,
  volume: 1
};

function canUseSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

export function useVoiceCoaching(
  message: string,
  options?: UseVoiceCoachingOptions
) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  const lastSpokenMessageRef = useRef("");
  const lastSpokenAtRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!config.enabled) return;
    if (!canUseSpeechSynthesis()) return;

    const normalized = normalizeMessage(message);
    if (!normalized) return;

    // Avoid speaking the initial mount message immediately.
    if (!mountedRef.current) {
      mountedRef.current = true;
      lastSpokenMessageRef.current = normalized;
      return;
    }

    const now = Date.now();
    const sameMessage = normalized === lastSpokenMessageRef.current;
    const insideCooldown = now - lastSpokenAtRef.current < config.cooldownMs;

    if (sameMessage || insideCooldown) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(normalized);
    utterance.rate = config.rate;
    utterance.pitch = config.pitch;
    utterance.volume = config.volume;

    lastSpokenMessageRef.current = normalized;
    lastSpokenAtRef.current = now;

    window.speechSynthesis.speak(utterance);
  }, [
    message,
    config.enabled,
    config.cooldownMs,
    config.rate,
    config.pitch,
    config.volume
  ]);

  useEffect(() => {
    return () => {
      if (canUseSpeechSynthesis()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);
}
