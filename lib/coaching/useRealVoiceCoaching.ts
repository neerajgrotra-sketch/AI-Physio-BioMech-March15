"use client";

import { useEffect, useRef } from "react";

type UseRealVoiceCoachingOptions = {
  enabled?: boolean;
  cooldownMs?: number;
  voice?: string;
  suppressPatterns?: RegExp[];
};

const DEFAULT_OPTIONS: Required<UseRealVoiceCoachingOptions> = {
  enabled: false,
  cooldownMs: 3200,
  voice: "marin",
  suppressPatterns: [
    /^hold\b/i,
    /^hold\.\s*\d/i,
    /^ready\b/i,
    /^tracking\b/i
  ]
};

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function shouldSuppress(message: string, suppressPatterns: RegExp[]): boolean {
  return suppressPatterns.some((pattern) => pattern.test(message));
}

export function useRealVoiceCoaching(
  message: string,
  options?: UseRealVoiceCoachingOptions
) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  const lastSpokenMessageRef = useRef("");
  const lastSpokenAtRef = useRef(0);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!config.enabled) return;

    const normalized = normalizeMessage(message);
    if (!normalized) return;
    if (shouldSuppress(normalized, config.suppressPatterns)) return;

    if (!mountedRef.current) {
      mountedRef.current = true;
      lastSpokenMessageRef.current = normalized;
      return;
    }

    const now = Date.now();
    const sameMessage = normalized === lastSpokenMessageRef.current;
    const insideCooldown = now - lastSpokenAtRef.current < config.cooldownMs;

    if (sameMessage || insideCooldown) return;

    let cancelled = false;

    async function speak() {
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: normalized,
            voice: config.voice
          })
        });

        if (!response.ok || cancelled) return;

        const blob = await response.blob();
        if (cancelled) return;

        if (currentAudioRef.current) {
          try {
            currentAudioRef.current.pause();
          } catch {}
          currentAudioRef.current = null;
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;

        lastSpokenMessageRef.current = normalized;
        lastSpokenAtRef.current = now;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (currentAudioRef.current === audio) {
            currentAudioRef.current = null;
          }
        };

        await audio.play();
      } catch {
        // fail silently for now
      }
    }

    void speak();

    return () => {
      cancelled = true;
    };
  }, [
    message,
    config.enabled,
    config.cooldownMs,
    config.voice,
    config.suppressPatterns
  ]);

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
        } catch {}
        currentAudioRef.current = null;
      }
    };
  }, []);
}
