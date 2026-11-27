import { describe, expect, it } from "vitest";
import { COACH_DEFAULTS, COACH_SETTING_DEFS, changedFromDefaults, orbitYaw, resolveCoachSettings } from "@/lib/coach/coachSettings";

describe("coach settings", () => {
  it("nothing saved: today's tuned values", () => {
    expect(resolveCoachSettings(null)).toEqual(COACH_DEFAULTS);
    expect(resolveCoachSettings({})).toEqual(COACH_DEFAULTS);
  });
  it("every default sits inside its range", () => {
    for (const d of COACH_SETTING_DEFS) {
      const v = COACH_DEFAULTS[d.key];
      if (d.kind === "number") { expect(v).toBeGreaterThanOrEqual(d.min!); expect(v).toBeLessThanOrEqual(d.max!); }
      else expect(typeof v).toBe("boolean");
    }
  });
  it("bad, out-of-range or unknown values can't break a session", () => {
    const s = resolveCoachSettings({ voiceRate: 9, wrongArmRiseDeg: "x", guideOrbitOn: "yes", junk: 1, stallSeconds: NaN });
    expect(s.voiceRate).toBe(1.2);
    expect(s.wrongArmRiseDeg).toBe(COACH_DEFAULTS.wrongArmRiseDeg);
    expect(s.guideOrbitOn).toBe(true);
    expect(s.stallSeconds).toBe(COACH_DEFAULTS.stallSeconds);
    expect((s as any).junk).toBeUndefined();
  });
  it("keeps pairs in order: near <= far, pause < countdown < end", () => {
    const s = resolveCoachSettings({ guideOrbitNearDeg: 50, guideOrbitFarDeg: 40, awayPauseSeconds: 50, awayCountdownSeconds: 20, awayEndSeconds: 30 });
    expect(s.guideOrbitNearDeg).toBeLessThanOrEqual(s.guideOrbitFarDeg);
    expect(s.awayCountdownSeconds).toBeGreaterThan(s.awayPauseSeconds);
    expect(s.awayEndSeconds).toBeGreaterThan(s.awayCountdownSeconds);
  });
  it("saves only what changed", () => {
    expect(changedFromDefaults({ ...COACH_DEFAULTS, voiceRate: 0.85 })).toEqual({ voiceRate: 0.85 });
  });
  it("the guide's turn stays between the nearest and furthest angles; off = stays side on", () => {
    for (let t = 0; t < 30; t += 0.7) {
      const y = orbitYaw(COACH_DEFAULTS, t);
      expect(y).toBeGreaterThanOrEqual(17.99); expect(y).toBeLessThanOrEqual(62.01);
    }
    expect(orbitYaw({ ...COACH_DEFAULTS, guideOrbitOn: false }, 3)).toBe(62);
  });
});
