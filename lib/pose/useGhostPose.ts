'use client';
// lib/pose/useGhostPose.ts
// Ghost pose state machine hook.
// Manages DEMO -> ATTEMPT -> HOLD -> REP_COMPLETE phases.
// Used by both SessionRunner and PoseDemoRunner.
//
// PHASES:
//   demo         — animated silhouette teaches the movement (2 cycles)
//   attempt      — ghost frozen at target, patient matches
//   holding      — patient is at target, hold countdown running
//   rep_complete — brief flash on rep completion
//
// INTENT DETECTION:
//   If score rises >= 0.10 over 20 frames during demo, switches to attempt
//   immediately without waiting for demo to finish.

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  POSE_BUILDERS, REST_BUILDERS, lerpGhost, computeMatchScore,
  type GhostJoints,
} from './poseBuilders';
import { getBodyFrame } from './bodyFrame';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GhostPhase = 'demo' | 'attempt' | 'holding' | 'rep_complete' | 'idle';

export interface GhostPoseState {
  phase: GhostPhase;
  ghostJoints: GhostJoints | null;
  matchScore: number;           // 0.0 - 1.0
  holdElapsedMs: number;        // ms elapsed in hold
  repCount: number;
  demoProgress: number;         // 0-1 for demo progress bar
  phaseLabel: string;
  phaseColor: string;
  phaseBg: string;
}

export interface UseGhostPoseOptions {
  slug: string;                 // exercise slug e.g. 'shoulder_flexion_right'
  targetDeg?: number;           // prescribed ROM target (defaults to norm in poseBuilders)
  holdTargetMs?: number;        // required hold duration in ms (default 5000)
  onRepComplete?: (repCount: number) => void;
  onSessionComplete?: () => void;
  repTarget?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMO_CYCLE_S       = 7;
const DEMO_CYCLES_FIRST  = 2;
const DEMO_CYCLES_REPEAT = 1;
const INTENT_DELTA       = 0.10;
const INTENT_MIN_SCORE   = 0.20;
const INTENT_WINDOW      = 20;
const MATCH_THRESHOLD    = 0.85;
const FAILURE_THRESHOLD  = 0.55;
const LOW_SCORE_TIMEOUT  = 8;    // seconds before repeat demo

// ─── Animation helpers ────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function cycleT(elapsedS: number): number {
  const t = (elapsedS % DEMO_CYCLE_S) / DEMO_CYCLE_S;
  if      (t < 0.14) return 0;
  else if (t < 0.43) return easeInOut((t - 0.14) / 0.29);
  else if (t < 0.64) return 1;
  else if (t < 0.93) return 1 - easeInOut((t - 0.64) / 0.29);
  else               return 0;
}

function demoLerp(elapsedS: number, isRepeat: boolean): { t: number; done: boolean } {
  const cycles = isRepeat ? DEMO_CYCLES_REPEAT : DEMO_CYCLES_FIRST;
  const totalS = DEMO_CYCLE_S * cycles;
  if (elapsedS >= totalS) return { t: cycleT(totalS - 0.01), done: true };
  return { t: cycleT(elapsedS), done: false };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGhostPose({
  slug,
  targetDeg,
  holdTargetMs = 5000,
  onRepComplete,
  onSessionComplete,
  repTarget,
}: UseGhostPoseOptions) {

  // ── Refs (read in render loop without stale closures) ──────────────────────
  const phaseRef        = useRef<GhostPhase>('idle');
  const phaseStartRef   = useRef<number>(performance.now());
  const holdStartRef    = useRef<number | null>(null);
  const lowScoreRef     = useRef<number>(0);
  const isRepeatRef     = useRef<boolean>(false);
  const scoreHistRef    = useRef<number[]>([]);
  const repCountRef     = useRef<number>(0);
  const slugRef         = useRef<string>(slug);
  const targetDegRef    = useRef<number | undefined>(targetDeg);

  // Keep refs in sync with props
  useEffect(() => { slugRef.current = slug; }, [slug]);
  useEffect(() => { targetDegRef.current = targetDeg; }, [targetDeg]);

  // ── React state (UI updates) ───────────────────────────────────────────────
  const [state, setState] = useState<GhostPoseState>({
    phase: 'idle',
    ghostJoints: null,
    matchScore: 0,
    holdElapsedMs: 0,
    repCount: 0,
    demoProgress: 0,
    phaseLabel: 'Start when ready',
    phaseColor: '#7cc6ff',
    phaseBg: 'rgba(124,198,255,0.08)',
  });

  // ── Phase transitions ──────────────────────────────────────────────────────
  const startPhase = useCallback((phase: GhostPhase, repeat = false) => {
    phaseRef.current = phase;
    phaseStartRef.current = performance.now();
    lowScoreRef.current = 0;
    holdStartRef.current = null;
    scoreHistRef.current = [];
    if (phase === 'demo') isRepeatRef.current = repeat;
    setState(s => ({ ...s, phase, holdElapsedMs: 0 }));
  }, []);

  // ── Start / reset ──────────────────────────────────────────────────────────
  const start = useCallback(() => {
    repCountRef.current = 0;
    startPhase('demo', false);
  }, [startPhase]);

  const reset = useCallback(() => {
    repCountRef.current = 0;
    startPhase('idle');
    setState(s => ({
      ...s,
      matchScore: 0,
      repCount: 0,
      demoProgress: 0,
      phaseLabel: 'Start when ready',
      phaseColor: '#7cc6ff',
      phaseBg: 'rgba(124,198,255,0.08)',
    }));
  }, [startPhase]);

  // ── Per-frame update — call this from your render loop ────────────────────
  // lms: mirrored BlazePose landmarks (x already flipped)
  // W, H: canvas dimensions
  // deltaS: seconds since last frame (~1/60)
  const update = useCallback((
    lms: { x: number; y: number; z: number; visibility?: number }[],
    W: number, H: number,
    deltaS: number
  ): {
    ghostJoints: GhostJoints | null;
    matchScore: number;
    holdElapsedMs: number;
    phase: GhostPhase;
  } => {
    const currentPhase = phaseRef.current;
    if (currentPhase === 'idle' || lms.length === 0) {
      return { ghostJoints: null, matchScore: 0, holdElapsedMs: 0, phase: currentPhase };
    }

    const frame = getBodyFrame(lms as any, W, H);
    if (!frame) return { ghostJoints: null, matchScore: 0, holdElapsedMs: 0, phase: currentPhase };

    const targetBuilder = POSE_BUILDERS[slugRef.current];
    const restBuilder   = REST_BUILDERS[slugRef.current];
    if (!targetBuilder || !restBuilder) {
      return { ghostJoints: null, matchScore: 0, holdElapsedMs: 0, phase: currentPhase };
    }

    const targetJoints = targetBuilder(frame, targetDegRef.current);
    const restJoints   = restBuilder(frame);
    const score        = computeMatchScore(lms, slugRef.current, W, H);
    const elapsed      = (performance.now() - phaseStartRef.current) / 1000;

    let ghostJoints: GhostJoints = targetJoints;
    let holdElapsedMs = 0;
    let newLabel = state.phaseLabel;
    let newColor = state.phaseColor;
    let newBg    = state.phaseBg;
    let demoProgress = state.demoProgress;

    if (currentPhase === 'demo') {
      // Intent detection
      const hist = scoreHistRef.current;
      hist.push(score);
      if (hist.length > INTENT_WINDOW) hist.shift();

      const isRepeat = isRepeatRef.current;
      const { t, done } = demoLerp(elapsed, isRepeat);
      const totalS = DEMO_CYCLE_S * (isRepeat ? DEMO_CYCLES_REPEAT : DEMO_CYCLES_FIRST);
      demoProgress = Math.min(elapsed / totalS, 1);
      ghostJoints = lerpGhost(restJoints, targetJoints, t);

      let patientIsAttempting = false;
      if (hist.length >= INTENT_WINDOW && score >= INTENT_MIN_SCORE) {
        if (score - hist[0] >= INTENT_DELTA) patientIsAttempting = true;
      }

      if (patientIsAttempting) {
        newLabel = 'Good \u2014 now hold that position!';
        newColor = '#4ade80'; newBg = 'rgba(74,222,128,0.12)';
        startPhase('attempt');
      } else if (done) {
        newLabel = 'Your turn \u2014 match the pose';
        newColor = '#60a5fa'; newBg = 'rgba(96,165,250,0.12)';
        startPhase('attempt');
      } else {
        if      (t < 0.05) { newLabel = isRepeat ? 'Watch again\u2026'   : 'Watch carefully\u2026'; newColor = '#60a5fa'; newBg = 'rgba(96,165,250,0.12)'; }
        else if (t < 0.95) { newLabel = 'Follow this movement';             newColor = '#a78bfa'; newBg = 'rgba(167,139,250,0.12)'; }
        else               { newLabel = 'Hold at the top';                  newColor = '#a78bfa'; newBg = 'rgba(167,139,250,0.12)'; }
      }

    } else if (currentPhase === 'attempt') {
      ghostJoints = targetJoints;

      if (score >= MATCH_THRESHOLD) {
        lowScoreRef.current = 0;
        if (!holdStartRef.current) holdStartRef.current = performance.now();
        holdElapsedMs = performance.now() - holdStartRef.current;

        if (holdElapsedMs >= holdTargetMs) {
          // Rep complete
          repCountRef.current += 1;
          const newRepCount = repCountRef.current;
          onRepComplete?.(newRepCount);
          startPhase('rep_complete');
          setTimeout(() => {
            if (repTarget && newRepCount >= repTarget) {
              onSessionComplete?.();
              startPhase('idle');
            } else {
              startPhase('attempt');
            }
          }, 1500);
          newLabel = 'Rep complete \u2014 well done!';
          newColor = '#4ade80'; newBg = 'rgba(74,222,128,0.12)';
        } else {
          const secsLeft = Math.max(1, Math.ceil((holdTargetMs - holdElapsedMs) / 1000));
          newLabel = `Great form \u2014 hold ${secsLeft}s`;
          newColor = '#4ade80'; newBg = 'rgba(74,222,128,0.12)';
        }
      } else {
        holdStartRef.current = null;
        lowScoreRef.current += deltaS;

        if (score >= FAILURE_THRESHOLD) {
          newLabel = 'Almost there \u2014 keep adjusting';
          newColor = '#fbbf24'; newBg = 'rgba(251,191,36,0.12)';
          lowScoreRef.current = 0;
        } else {
          newLabel = 'Match the blue silhouette';
          newColor = '#60a5fa'; newBg = 'rgba(96,165,250,0.12)';
        }

        if (lowScoreRef.current > LOW_SCORE_TIMEOUT) {
          newLabel = 'Let me show you again\u2026';
          newColor = '#a78bfa'; newBg = 'rgba(167,139,250,0.12)';
          startPhase('demo', true);
        }
      }

    } else if (currentPhase === 'rep_complete') {
      ghostJoints = targetJoints;
      newLabel = 'Rep complete \u2014 well done!';
      newColor = '#4ade80'; newBg = 'rgba(74,222,128,0.12)';
    }

    // Batch React state update
    setState(s => ({
      ...s,
      phase: phaseRef.current,
      ghostJoints,
      matchScore: score,
      holdElapsedMs,
      repCount: repCountRef.current,
      demoProgress,
      phaseLabel: newLabel,
      phaseColor: newColor,
      phaseBg: newBg,
    }));

    return {
      ghostJoints,
      matchScore: score,
      holdElapsedMs,
      phase: phaseRef.current,
    };
  }, [holdTargetMs, onRepComplete, onSessionComplete, repTarget, startPhase, state.phaseLabel, state.phaseColor, state.phaseBg, state.demoProgress]);

  return { state, start, reset, update, startPhase };
}
