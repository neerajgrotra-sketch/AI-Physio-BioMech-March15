import { describe, expect, it } from "vitest";
import { BACK_AFTER_MS, PresenceTracker, seenInFrame } from "@/lib/session/presence";

const fr = (ok: boolean, score = 0.9) => ({
  personDetected: ok,
  landmarks: { left_shoulder: { x: 0.4, y: 0.4, score }, right_shoulder: { x: 0.6, y: 0.4, score } },
});

describe("seenInFrame", () => {
  it("needs a person with both shoulders clearly seen", () => {
    expect(seenInFrame(fr(true))).toBe(true);
    expect(seenInFrame(fr(false))).toBe(false);
    expect(seenInFrame(fr(true, 0.2))).toBe(false);
    expect(seenInFrame(null)).toBe(false);
  });
});

describe("PresenceTracker (the owner's run: one stray frame said 'welcome back')", () => {
  it("a stray frame or two in an empty room doesn't bring the patient back", () => {
    const p = new PresenceTracker(0);
    let t = 0;
    for (; t < 3000; t += 33) p.update(t, false);
    expect(p.present).toBe(false);
    const goneAt = p.lastPresentMs;
    // Stray detections: a few frames every couple of seconds, for 30 s.
    for (; t < 33000; t += 33) p.update(t, t % 2000 < 200);
    expect(p.present).toBe(false);
    expect(p.lastPresentMs).toBe(goneAt); // the walk-away timer keeps running
  });

  it("really back: present after a steady second and a half", () => {
    const p = new PresenceTracker(0);
    let t = 0;
    for (; t < 3000; t += 33) p.update(t, false);
    for (; t < 3000 + BACK_AFTER_MS - 100; t += 33) expect(p.update(t, true)).toBe(false);
    for (; t < 3000 + BACK_AFTER_MS + 100; t += 33) p.update(t, true);
    expect(p.present).toBe(true);
  });

  it("a short dropout while moving doesn't count as leaving", () => {
    const p = new PresenceTracker(0);
    let t = 0;
    for (; t < 2000; t += 33) p.update(t, true);
    for (; t < 2600; t += 33) p.update(t, false);
    for (; t < 4000; t += 33) p.update(t, true);
    expect(p.present).toBe(true);
  });
});
