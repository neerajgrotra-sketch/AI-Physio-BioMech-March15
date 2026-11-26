import { describe, expect, it } from "vitest";
import { RepCoach, type RepCoachInput } from "@/lib/coaching/repCoach";

const base: Omit<RepCoachInput, "nowMs" | "phase" | "metric"> = {
  target: 110, repCount: 0, repTarget: 6, elbowBent: false, wrongPlane: false,
};

/** Runs frames every 100 ms; returns what was said, with times. */
function run(c: RepCoach, frames: Array<Partial<RepCoachInput> & { phase: string; metric: number | null }>, start = 0) {
  const said: Array<[number, string]> = [];
  frames.forEach((f, k) => {
    const t = start + k * 100;
    const out = c.update({ ...base, ...f, nowMs: t });
    if (out) said.push([t, out]);
  });
  return said;
}
const repeat = <T,>(x: T, n: number) => Array.from({ length: n }, () => x);

describe("RepCoach", () => {
  it("a smooth rep up to the target says nothing extra", () => {
    const c = new RepCoach();
    const up = Array.from({ length: 10 }, (_, k) => ({ phase: "lifting", metric: 40 + k * 8 }));
    expect(run(c, [...up, ...repeat({ phase: "holding", metric: 115 }, 20)])).toEqual([]);
  });

  it("stalling below the target: 'A little higher', not over and over", () => {
    const c = new RepCoach();
    const said = run(c, [{ phase: "lifting", metric: 60 }, ...repeat({ phase: "lifting", metric: 85 }, 60)]);
    expect(said.map((s) => s[1])).toContain("A little higher.");
    expect(said.length).toBeLessThanOrEqual(2); // 6 s of stalling: at most twice
  });

  it("no 'higher' when already near the target", () => {
    const c = new RepCoach();
    expect(run(c, repeat({ phase: "lifting", metric: 107 }, 40))).toEqual([]);
  });

  it("a bent elbow while raising: 'Keep your arm straight'", () => {
    const c = new RepCoach();
    const said = run(c, repeat({ phase: "lifting", metric: 70, elbowBent: true }, 12));
    expect(said[0][1]).toBe("Keep your arm straight.");
  });

  it("going out to the side: 'Bring your arm in front of you' (before anything else)", () => {
    const c = new RepCoach();
    const said = run(c, repeat({ phase: "lifting", metric: 70, elbowBent: true, wrongPlane: true }, 12));
    expect(said[0][1]).toBe("Bring your arm in front of you.");
  });

  it("a bent elbow at rest is not coached (hands on the lap)", () => {
    const c = new RepCoach();
    expect(run(c, repeat({ phase: "ready", metric: 40, elbowBent: true }, 30))).toEqual([]);
  });

  it("back at rest after a rep: 'And again', once", () => {
    const c = new RepCoach();
    const said = run(c, repeat({ phase: "ready", metric: 40, repCount: 2 }, 50));
    expect(said.map((s) => s[1])).toEqual(["And again."]);
  });

  it("no 'And again' after the last rep", () => {
    const c = new RepCoach();
    expect(run(c, repeat({ phase: "ready", metric: 40, repCount: 6 }, 50))).toEqual([]);
  });
});

describe("RepCoach: correcting the direction", () => {
  it("out to the side, then brought in front on the way up: 'That's better'", () => {
    const c = new RepCoach();
    const said = run(c, [
      ...repeat({ phase: "lifting", metric: 70, wrongPlane: true }, 10),
      ...repeat({ phase: "lifting", metric: 80, wrongPlane: false }, 5),
    ]);
    expect(said.map((s) => s[1])).toEqual(["Bring your arm in front of you.", "That's better."]);
  });
});
