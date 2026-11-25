import { describe, expect, it } from "vitest";
import { calibrateThresholds, SpikeFilter, MAX_BASELINE_DEG } from "@/lib/engine/calibration";
import { kneeExtensionThresholds } from "@/lib/exercises/kneeThresholds";

describe("calibrateThresholds", () => {
  const rest = [14, 15, 16, 15, 14, 16, 15, 15, 17, 14];

  it("does not shift the target by the resting reading", () => {
    // The old code made a 110° target into 110 + 15 = 125°.
    const t = calibrateThresholds(rest, { romAcceptableMin: 110, romTargetDegrees: null })!;
    expect(t.baseline).toBe(14);
    expect(t.target).toBe(110);
    expect(t.start).toBe(29);
    expect(t.finish).toBe(24);
  });

  it("uses the physio target, and lets the hold sag to the population minimum", () => {
    const t = calibrateThresholds(rest, { romAcceptableMin: 110, romTargetDegrees: 140 })!;
    expect(t.target).toBe(140);
    expect(t.tolerance).toBe(30); // hold floor 110
  });

  it("caps the baseline when the patient was already moving", () => {
    const moving = [60, 70, 80, 90, 95, 100, 110, 120, 130, 140];
    const t = calibrateThresholds(moving, { romAcceptableMin: 110, romTargetDegrees: null })!;
    expect(t.baseline).toBe(MAX_BASELINE_DEG);
    expect(t.target).toBeGreaterThanOrEqual(t.start + 20);
  });

  it("needs at least 5 samples", () => {
    expect(calibrateThresholds([10, 11], { romAcceptableMin: 110, romTargetDegrees: null })).toBeNull();
  });
});

describe("SpikeFilter", () => {
  it("drops a single-frame glitch", () => {
    const f = new SpikeFilter(45, 3);
    expect([15, 16, 103, 17, 18].map((v) => f.filter(v))).toEqual([15, 16, 16, 17, 18]);
  });

  it("accepts a real change once it lasts 3 frames (the old filter froze forever)", () => {
    const f = new SpikeFilter(45, 3);
    const out = [20, 90, 92, 93, 94].map((v) => f.filter(v));
    expect(out).toEqual([20, 20, 20, 93, 94]);
  });

  it("passes gaps through without forgetting the last value", () => {
    const f = new SpikeFilter(45, 3);
    expect([20, null, 22].map((v) => f.filter(v))).toEqual([20, null, 22]);
  });
});

describe("kneeExtensionThresholds (templates store flexion: 0 = straight)", () => {
  it("converts the live template values", () => {
    // knee_extension_*: rom_start 90, rom_norm 0, rom_acceptable_min 30
    const k = kneeExtensionThresholds({ romStartDegrees: 90, romNormDegrees: 0, romAcceptableMin: 30, romTargetDegrees: null });
    expect(k).toMatchObject({ startThreshold: 105, targetThreshold: 150, finishThreshold: 100, targetValue: 180 });
    expect(k.targetThreshold).toBeGreaterThan(k.startThreshold);
  });

  it("reads a physio target in either convention", () => {
    const base = { romStartDegrees: 90, romNormDegrees: 0, romAcceptableMin: 30 };
    expect(kneeExtensionThresholds({ ...base, romTargetDegrees: 10 }).targetThreshold).toBe(170);
    expect(kneeExtensionThresholds({ ...base, romTargetDegrees: 160 }).targetThreshold).toBe(160);
  });

  it("never sets the target at or below the start", () => {
    const k = kneeExtensionThresholds({ romStartDegrees: 90, romNormDegrees: 0, romAcceptableMin: 80, romTargetDegrees: null });
    expect(k.targetThreshold).toBeGreaterThanOrEqual(k.startThreshold + 20);
  });
});
