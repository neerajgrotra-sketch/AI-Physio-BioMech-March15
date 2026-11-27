import { describe, expect, it } from "vitest";
import { awayState, resumePlan } from "@/lib/session/resume";

const now = new Date(2026, 10, 27, 15, 0);
const at = (h: number, d = 27) => new Date(2026, 10, d, h, 0).toISOString();

describe("resumePlan", () => {
  it("paused after the first of two exercises, same day: continue with the second", () => {
    expect(resumePlan({ status: "paused", progress: { done: [0], total: 2, updated_at: at(11) }, total: 2, now }))
      .toEqual({ resumable: true, done: [0], remaining: [1] });
  });
  it("a tab closed mid-session (still in progress) can be resumed too", () => {
    expect(resumePlan({ status: "in_progress", progress: { done: [0, 1], total: 3, updated_at: at(14) }, total: 3, now }).remaining).toEqual([2]);
  });
  it("the next day it starts fresh", () => {
    expect(resumePlan({ status: "paused", progress: { done: [0], total: 2, updated_at: at(20, 26) }, total: 2, now }).resumable).toBe(false);
  });
  it("nothing finished yet: nothing to resume (the cut-off exercise starts again anyway)", () => {
    expect(resumePlan({ status: "paused", progress: { done: [], total: 2, updated_at: at(11) }, total: 2, now }).resumable).toBe(false);
  });
  it("completed, pending or no progress: fresh", () => {
    for (const status of ["completed", "pending", null]) {
      expect(resumePlan({ status, progress: { done: [0], total: 2, updated_at: at(11) }, total: 2, now }).resumable).toBe(false);
    }
    expect(resumePlan({ status: "paused", progress: null, total: 2, now }).resumable).toBe(false);
  });
  it("the protocol changed since (a different number of exercises): fresh", () => {
    expect(resumePlan({ status: "paused", progress: { done: [0], total: 2, updated_at: at(11) }, total: 3, now }).resumable).toBe(false);
  });
  it("finished out of order or with repeats: done is cleaned up, the rest stays in order", () => {
    expect(resumePlan({ status: "paused", progress: { done: [2, 0, 2, 9], total: 4, updated_at: at(9) }, total: 4, now }))
      .toEqual({ resumable: true, done: [0, 2], remaining: [1, 3] });
  });
});

describe("awayState", () => {
  it("present for the first 10 s, then paused, a countdown from 60 s, and the end at 90 s", () => {
    expect(awayState(3).kind).toBe("present");
    expect(awayState(12).kind).toBe("paused");
    expect(awayState(61)).toEqual({ kind: "countdown", secondsLeft: 29 });
    expect(awayState(89.2)).toEqual({ kind: "countdown", secondsLeft: 1 });
    expect(awayState(90).kind).toBe("end");
  });
});
