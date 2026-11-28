import { describe, expect, it } from "vitest";
import { COACH_DEFAULTS } from "@/lib/coach/coachSettings";
import { cleanTolerances, effectiveTolerances, presetOf, PRESETS } from "@/lib/coach/patientTolerances";

describe("per-patient tolerances", () => {
  it("nothing set for the patient: the clinic's values", () => {
    expect(effectiveTolerances(null, COACH_DEFAULTS)).toEqual({ sidewaysAllowanceDeg: 75, holdSlipSeconds: 1, otherArmAllowanceDeg: 35 });
    const clinic = { ...COACH_DEFAULTS, sidewaysAllowanceDeg: 70 };
    expect(effectiveTolerances({}, clinic).sidewaysAllowanceDeg).toBe(70);
  });
  it("the patient's setting wins over the clinic's", () => {
    const e = effectiveTolerances({ sidewaysAllowanceDeg: 85, holdSlipSeconds: 2 }, { ...COACH_DEFAULTS, sidewaysAllowanceDeg: 70 });
    expect(e.sidewaysAllowanceDeg).toBe(85);
    expect(e.holdSlipSeconds).toBe(2);
    expect(e.otherArmAllowanceDeg).toBe(35);
  });
  it("bad or out-of-range values are dropped or clamped", () => {
    expect(cleanTolerances({ sidewaysAllowanceDeg: 400, holdSlipSeconds: "x", junk: 1 })).toEqual({ sidewaysAllowanceDeg: 90 });
  });
  it("recognises the presets; anything else is custom", () => {
    expect(presetOf({})).toBe("standard");
    expect(presetOf(PRESETS.gentle.values)).toBe("gentle");
    expect(presetOf(PRESETS.strict.values)).toBe("strict");
    expect(presetOf({ sidewaysAllowanceDeg: 80 })).toBe("custom");
  });
  it("presets stay inside the allowed ranges", () => {
    for (const p of Object.values(PRESETS)) expect(cleanTolerances(p.values)).toEqual(p.values);
  });
});
