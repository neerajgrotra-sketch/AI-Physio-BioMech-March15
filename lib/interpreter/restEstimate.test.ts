import { describe, expect, it } from "vitest";
import { nextRest, REST_SHARE_PER_FRAME } from "@/lib/interpreter/restEstimate";

const run = (start: number, values: number[]) => values.reduce<number | null>((r, v) => nextRest(r, v, REST_SHARE_PER_FRAME), start);
const frames = (v: number, n: number) => Array.from({ length: n }, () => v);

describe("nextRest", () => {
  it("run A-A4D8281D: a camera dip (10° for 1 s, then ~27° for 1.5 s) barely moves a 45° rest", () => {
    const rest = run(45, [...frames(10, 30), ...frames(27, 45)])!;
    expect(rest).toBeGreaterThan(30);
    // so the resting arm back at 48-55° stays within the isolation limit (rest + 35)
    expect(55).toBeLessThanOrEqual(rest + 35);
  });
  it("a real lift (more than 10° above) is never learned as the rest", () => {
    expect(run(45, [...frames(60, 30), ...frames(110, 60)])).toBe(45);
  });
  it("an arm that really settles lower is followed within a few seconds", () => {
    expect(run(45, frames(25, 300))!).toBeLessThan(28); // 10 s at 30 fps
  });
  it("no reading keeps the rest; the first reading sets it", () => {
    expect(nextRest(40, null, 0.5)).toBe(40);
    expect(nextRest(null, 33, 0.01)).toBe(33);
  });
});
