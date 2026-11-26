import { describe, expect, it } from "vitest";
import { DemoNarrator, FIRST_DEMO, REPEAT_DEMO } from "@/lib/coaching/demoNarrator";
import { demoClock, DEMO_CYCLE_S, IDLE_BEFORE_REPEAT_S } from "@/lib/pose/ghostAnimator";

/** Runs the narrator over `seconds` of the demo clock at 30 fps. */
function narrate(seconds: number, busyAt: (s: number) => boolean = () => false) {
  const n = new DemoNarrator();
  const said: Array<[number, string]> = [];
  for (let k = 0; k <= seconds * 30; k++) {
    const s = k / 30;
    const line = n.update(demoClock(s), busyAt(s));
    if (line) said.push([s, line]);
  }
  return said;
}

describe("demoClock", () => {
  it("first showing, then a wait, then a repeat", () => {
    expect(demoClock(1)).toEqual({ cycle: 0, t: 1 });
    expect(demoClock(DEMO_CYCLE_S + 1)).toBeNull();
    expect(demoClock(DEMO_CYCLE_S + IDLE_BEFORE_REPEAT_S + 0.5)!.cycle).toBe(1);
  });
});

describe("DemoNarrator", () => {
  it("narrates the first demonstration in step with the figure", () => {
    const said = narrate(DEMO_CYCLE_S);
    expect(said.map((x) => x[1])).toEqual(FIRST_DEMO.map((l) => l.text));
    // "Up to here" when the figure reaches the target (2 s).
    const up = said.find((x) => x[1].startsWith("Up to here"))!;
    expect(Math.abs(up[0] - 2.0)).toBeLessThan(0.1);
  });

  it("says nothing while the figure waits, then a shorter version on a repeat", () => {
    const said = narrate(DEMO_CYCLE_S + IDLE_BEFORE_REPEAT_S + DEMO_CYCLE_S);
    const repeat = said.filter((x) => x[0] > DEMO_CYCLE_S + 1).map((x) => x[1]);
    expect(repeat).toEqual(REPEAT_DEMO.map((l) => l.text));
  });

  it("if the voice is busy, a line is delayed a little, or skipped rather than said out of step", () => {
    // Busy for the first 1.5 s (e.g. the exercise intro): "Watch me first" is skipped.
    const said = narrate(DEMO_CYCLE_S, (s) => s < 1.5);
    expect(said.map((x) => x[1])).not.toContain("Watch me first.");
    expect(said.map((x) => x[1])).toContain("Up to here. Hold.");
  });
});
