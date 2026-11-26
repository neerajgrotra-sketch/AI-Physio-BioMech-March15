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

describe("RepCoach: the wrong arm", () => {
  const right = { side: "right" as const, startThreshold: 50 };
  it("lifting the left arm in a right-arm exercise: told which arm, and highlighted", () => {
    const c = new RepCoach();
    const said = run(c, [
      ...repeat({ phase: "ready", metric: 20, oppositeMetric: 20, ...right }, 20), // both resting
      ...repeat({ phase: "ready", metric: 20, oppositeMetric: 100, ...right }, 12), // left arm up
    ]);
    expect(said.map((s) => s[1])).toEqual(["That's your left arm. Rest it down and lift your right arm."]);
    expect(c.wrongArmNow).toBe(true);
  });

  it("the other arm resting on the lap (already 50°) is not 'wrong'", () => {
    const c = new RepCoach();
    expect(run(c, repeat({ phase: "ready", metric: 45, oppositeMetric: 52, ...right }, 40))).toEqual([]);
  });

  it("both arms up is not called the wrong arm (the rep logic fails it as isolation)", () => {
    const c = new RepCoach();
    const said = run(c, [
      ...repeat({ phase: "ready", metric: 20, oppositeMetric: 20, ...right }, 20),
      ...repeat({ phase: "lifting", metric: 100, oppositeMetric: 100, ...right }, 12),
    ]);
    expect(said.map((s) => s[1]).some((t) => t.includes("your left arm"))).toBe(false);
  });
});

describe("RepCoach: the wrong arm, tried again and again", () => {
  const right = { side: "right" as const, startThreshold: 50 };
  it("each new wrong lift is called out (not just the first)", () => {
    const c = new RepCoach();
    const lift = [
      ...repeat({ phase: "ready", metric: 20, oppositeMetric: 100, ...right }, 8),  // up 0.8 s
      ...repeat({ phase: "ready", metric: 20, oppositeMetric: 20, ...right }, 17),  // down 1.7 s
    ];
    const said = run(c, [...repeat({ phase: "ready", metric: 20, oppositeMetric: 20, ...right }, 20), ...lift, ...lift, ...lift]);
    expect(said.filter((s) => s[1].includes("left arm")).length).toBe(3);
  });

  it("held up, the call repeats", () => {
    const c = new RepCoach();
    const said = run(c, [...repeat({ phase: "ready", metric: 20, oppositeMetric: 20, ...right }, 20), ...repeat({ phase: "ready", metric: 20, oppositeMetric: 100, ...right }, 100)]);
    expect(said.filter((s) => s[1].includes("left arm")).length).toBeGreaterThanOrEqual(3);
  });

  it("marks its line as a correction", () => {
    const c = new RepCoach();
    run(c, repeat({ phase: "ready", metric: 20, oppositeMetric: 20, ...right }, 20));
    let kind: string | null = null;
    for (let k = 0; k < 10; k++) { if (c.update({ ...base, ...right, phase: "ready", metric: 20, oppositeMetric: 100, nowMs: 2000 + k * 100 })) kind = c.lastKind; }
    expect(kind).toBe("wrongArm");
  });
});

describe("RepCoach: the wrong arm lifted at normal speed (owner's v0.6.0 run)", () => {
  const right = { side: "right" as const, startThreshold: 68.8 };
  it("the other arm rising smoothly from 55 to 116 over a second, at 30 frames a second, is called out", () => {
    const c = new RepCoach();
    const said: string[] = [];
    let t = 0;
    const step = (opp: number) => { const out = c.update({ ...base, ...right, phase: "ready", metric: 55, oppositeMetric: opp, nowMs: t }); t += 33; if (out) said.push(out); };
    for (let k = 0; k < 90; k++) step(55);                 // 3 s resting on the lap
    for (let k = 0; k <= 30; k++) step(55 + (61 * k) / 30); // up over 1 s
    for (let k = 0; k < 30; k++) step(116);                // held 1 s
    expect(said.filter((x) => x.includes("left arm")).length).toBeGreaterThanOrEqual(1);
  });

  it("a slow lift over three seconds is called out too", () => {
    const c = new RepCoach();
    const said: string[] = [];
    let t = 0;
    const step = (opp: number) => { const out = c.update({ ...base, ...right, phase: "ready", metric: 55, oppositeMetric: opp, nowMs: t }); t += 33; if (out) said.push(out); };
    for (let k = 0; k < 90; k++) step(55);
    for (let k = 0; k <= 90; k++) step(55 + (60 * k) / 90);
    for (let k = 0; k < 20; k++) step(115);
    expect(said.some((x) => x.includes("left arm"))).toBe(true);
  });

  it("small shifts of the resting arm (a few degrees) are not called out", () => {
    const c = new RepCoach();
    const said: string[] = [];
    let t = 0;
    for (let k = 0; k < 600; k++) {
      const opp = 55 + 6 * Math.sin(k / 20) + (k > 300 ? 8 : 0); // fidgeting, then settles 8° higher
      const out = c.update({ ...base, ...right, phase: "ready", metric: 55, oppositeMetric: opp, nowMs: t }); t += 33;
      if (out) said.push(out);
    }
    expect(said.some((x) => x.includes("left arm"))).toBe(false);
  });
});
