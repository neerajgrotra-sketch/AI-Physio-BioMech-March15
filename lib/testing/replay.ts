// ============================================================
// lib/testing/replay.ts — run pose frames through the engine
// ============================================================
// Mirrors the per-frame steps of lib/session/useInferenceLoop.ts:
//   extract -> 5-frame smoothing -> facing view (flexionView) -> calibration (arm exercises) ->
//   spike filter -> interpretMovement
// If you change the order or the steps there, change them here too.
// ============================================================

import { extractMovementFeatures, emptyMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { FlexionViewEstimator } from "@/lib/biomechanics/flexionView";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";
import { createInitialRepState } from "@/lib/interpreter/repStateMachine";
import { interpretMovement, getEffectiveActiveMetricValue } from "@/lib/interpreter/movementInterpreter";
import { applyThresholds, calibrateThresholds, calibrationKindFor, FeatureSpikeFilter } from "@/lib/engine/calibration";
import type { ExercisePrescription } from "@/lib/types/exercise";
import type { PoseFrame } from "@/lib/types/pose";

export const CALIBRATION_WINDOW_MS = 3000; // same as useInferenceLoop

export type ReplayEvent = { t: number; kind: "rep" | "fail" | "hold"; reason?: string | null };

export function replay(prescription: ExercisePrescription, frames: PoseFrame[]) {
  const p: ExercisePrescription = structuredClone(prescription);
  let rep = createInitialRepState();
  const history = new FeatureHistory(5);
  const spikes = new FeatureSpikeFilter();
  const view = new FlexionViewEstimator();
  const samples: number[] = [];
  let calibStart: number | null = null;
  let calibrated = false;
  const events: ReplayEvent[] = [];
  const metric: Array<number | null> = [];

  for (const frame of frames) {
    const now = frame.timestamp;
    if (frame.personDetected) history.push(extractMovementFeatures(frame));
    else history.clear();
    const f = frame.personDetected ? smoothMovementFeatures(history.getAll()) : emptyMovementFeatures();
    if (frame.personDetected) view.apply(f);

    if (frame.personDetected && !calibrated) {
      if (calibrationKindFor(p.target.metric) === "none") calibrated = true;
      else {
        calibStart ??= now;
        const s = getEffectiveActiveMetricValue(f, p);
        if (s !== null) samples.push(s);
        if (now - calibStart >= CALIBRATION_WINDOW_MS) {
          calibrated = true;
          const t = calibrateThresholds(samples, {
            romAcceptableMin: (p as any).romAcceptableMin ?? null,
            romTargetDegrees: (p as any).romTargetDegrees ?? null,
          });
          if (t) applyThresholds(p, t);
        }
      }
    }

    spikes.apply(f, p.target.metric);

    const out = interpretMovement(rep, f, p, {
      timestampMs: now, personDetected: frame.personDetected, balanceOk: true, activeMetricValue: null,
    });
    rep = out.repState;
    metric.push(out.activeMetricValue);
    if (rep.justCompletedRep) events.push({ t: now, kind: "rep" });
    if (rep.justFailedRep) events.push({ t: now, kind: "fail", reason: rep.lastRepEvaluation.reason });
    if (rep.justCompletedHold) events.push({ t: now, kind: "hold" });
  }

  return { repCount: rep.repCount, phase: rep.phase, events, metric, prescription: p, view: view.currentView() };
}

/** A timeline of [durationMs, value-or-function-of-progress] segments, sampled at `fps`. */
export function timeline(
  segments: Array<[number, (u: number) => number]>,
  fps = 30
): Array<{ t: number; v: number }> {
  const out: Array<{ t: number; v: number }> = [];
  let t0 = 0;
  for (const [ms, fn] of segments) {
    const n = Math.max(1, Math.round((ms / 1000) * fps));
    for (let i = 0; i < n; i++) out.push({ t: t0 + (i * 1000) / fps, v: fn(i / n) });
    t0 += (n * 1000) / fps;
  }
  return out;
}

export const hold = (v: number) => () => v;
export const ramp = (a: number, b: number) => (u: number) => a + (b - a) * u;
