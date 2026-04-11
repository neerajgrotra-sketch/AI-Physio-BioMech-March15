"use client";

import { useEffect, useRef } from "react";

type UseVoiceCoachingOptions = {
  enabled?: boolean;
  cooldownMs?: number;
  rate?: number;
  pitch?: number;
  volume?: number;
  minMessageLength?: number;
  suppressPatterns?: RegExp[];
};

const DEFAULT_OPTIONS: Required<UseVoiceCoachingOptions> = {
  enabled: true,
  cooldownMs: 3200,
  rate: 0.94,
  pitch: 1,
  volume: 1,
  minMessageLength: 8,
  suppressPatterns: [
    /^hold\b/i,
    /^hold\.\s*\d/i,
    /^ready\b/i,
    /^tracking\b/i,
    /^move slowly and stay in control\.?$/i
  ]
};

function canUseSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function shouldSuppress(
  message: string,
  options: Required<UseVoiceCoachingOptions>
): boolean {
  if (!message || message.length < options.minMessageLength) return true;

  return options.suppressPatterns.some((pattern) => pattern.test(message));
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

    if (!mountedRef.current) {
      mountedRef.current = true;
      lastSpokenMessageRef.current = normalized;
      return;
    }

    if (shouldSuppress(normalized, config)) return;

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
    config.volume,
    config.minMessageLength,
    config.suppressPatterns
  ]);

  useEffect(() => {
    return () => {
      if (canUseSpeechSynthesis()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);
}
