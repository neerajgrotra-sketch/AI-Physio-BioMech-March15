import { describe, expect, it } from "vitest";
import { AngleBias, GIVE_UP_MS, ReachCheck } from "@/lib/session/reachCheck";

const S = { off: { dx: 0.1, dy: -1.2 }, straight: true, elev3d: null as number | null };
/** Runs a metric path (per 33 ms frame); returns the lines said. */
function run(c: ReachCheck, path: number[], s = S, t0 = 0) {
  const said: string[] = [];
  path.forEach((m, k) => {
    const line = c.update(t0 + k * 33, m, { ...s, elev3d: s.elev3d === null ? null : m + 22 });
    if (line) said.push(line);
  });
  return said;
}
const seg = (a: number, b: number, ms: number) => Array.from({ length: Math.round(ms / 33) }, (_, i) => a + ((b - a) * i) / Math.round(ms / 33));

describe("ReachCheck (the range check before the first rep)", () => {
  it("asks, waits for the top, holds, asks to lower, and records the range", () => {
    const c = new ReachCheck({ side: "right", start: 55, target: 110, nowMs: 0 });
    const said = run(c, [...seg(30, 30, 2000), ...seg(30, 125, 1500), ...seg(125, 125, 3500), ...seg(125, 30, 1500), ...seg(30, 30, 500)], { ...S, elev3d: 0 });
    expect(said[0]).toMatch(/right arm.*as high as is comfortable/);
    expect(said).toContain("That's great. And slowly down.");
    expect(said[said.length - 1]).toBe("Thank you. Now the exercise.");
    expect(c.stage).toBe("done");
    const r = c.result();
    expect(r.peak).toBeCloseTo(125, 0);
    expect(r.reached).toBe(true);
    expect(r.offsets.length).toBeGreaterThan(0);      // the hand was noted at the target
    expect(r.bias).toBeCloseTo(22, 0);                // 3D read 22° higher
  });

  it("below the target: still thanks them (no failure), and says so gently", () => {
    const c = new ReachCheck({ side: "left", start: 55, target: 110, nowMs: 0 });
    const said = run(c, [...seg(30, 30, 500), ...seg(30, 95, 1500), ...seg(95, 95, 3500), ...seg(95, 30, 1500)]);
    expect(said[said.length - 1]).toMatch(/a little higher/);
    expect(c.result().reached).toBe(false);
    expect(c.result().offsets).toEqual([]);           // never at the target
  });

  it("lowering without holding still records the peak", () => {
    const c = new ReachCheck({ side: "right", start: 55, target: 110, nowMs: 0 });
    run(c, [...seg(30, 30, 500), ...seg(30, 115, 1000), ...seg(115, 30, 1000), ...seg(30, 30, 500)]);
    expect(c.stage).toBe("done");
    expect(c.result().peak).toBeGreaterThan(110);
  });

  it("no lift: reminds once, then carries on without it", () => {
    const c = new ReachCheck({ side: "right", start: 55, target: 110, nowMs: 0 });
    const said = run(c, seg(30, 30, GIVE_UP_MS + 1000));
    expect(said.length).toBe(3);
    expect(c.stage).toBe("done");
    expect(c.result().skipped).toBe("no_lift");
  });

  it("waits for silence before asking", () => {
    const c = new ReachCheck({ side: "right", start: 55, target: 110, nowMs: 0 });
    expect(c.update(0, 30, S, false)).toBeNull();
    expect(c.update(5000, 30, S, true)).toMatch(/as high as is comfortable/);
  });
});

describe("AngleBias", () => {
  it("is 0 until known, then the median gap, clamped", () => {
    const b = new AngleBias();
    expect(b.get()).toBe(0);
    for (let i = 0; i < 10; i++) b.add(100 + i, 122 + i, true);
    expect(b.get()).toBeCloseTo(22, 0);
    b.reset(); b.seed(60);
    expect(b.get()).toBe(35);
    b.reset(); for (let i = 0; i < 10; i++) b.add(60, 50, true); // below 70: ignored
    expect(b.get()).toBe(0);
  });
});
