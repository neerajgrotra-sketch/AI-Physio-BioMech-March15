import { describe, expect, it } from "vitest";
import { exerciseSeconds, sessionMinutes, sessionSeconds } from "@/lib/app/sessionDuration";

describe("session duration", () => {
  it("one exercise: set-up plus each rep's movement and hold", () => {
    expect(exerciseSeconds({ reps: 6, holdMs: 2000 })).toBe(45 + 6 * 6);
  });
  it("two shoulder flexions of 6 reps with 2 s holds take about 3 minutes, not 10", () => {
    const list = [{ reps: 6, holdMs: 2000 }, { reps: 6, holdMs: 2000 }];
    expect(sessionSeconds(list)).toBe(15 + 2 * 81);
    expect(sessionMinutes(list)).toBe(3);
  });
  it("six exercises of 3 reps with 3 s holds", () => {
    expect(sessionMinutes(Array.from({ length: 6 }, () => ({ reps: 3, holdMs: 3000 })))).toBe(7);
  });
  it("no exercises: 0; a tiny one rounds up to 1 minute", () => {
    expect(sessionMinutes([])).toBe(0);
    expect(sessionMinutes([{ reps: 1, holdMs: 0 }])).toBe(2); // 15 + 45 + 4 = 64 s
  });
});
