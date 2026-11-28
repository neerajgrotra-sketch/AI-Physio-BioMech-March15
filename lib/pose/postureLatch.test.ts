import { describe, expect, it } from "vitest";
import { PostureLatch, SWITCH_AFTER_MS } from "@/lib/pose/postureLatch";

describe("PostureLatch", () => {
  it("ignores flicker (the owner's test: the guide kept flipping)", () => {
    const l = new PostureLatch("seated");
    for (let t = 0; t < 20000; t += 100) {
      // Flickering every half second between seated, standing and unknown.
      const raw = Math.floor(t / 500) % 3 === 0 ? "standing" : Math.floor(t / 500) % 3 === 1 ? "unknown" : "seated";
      expect(l.update(raw, t)).toBe("seated");
    }
  });

  it("switches once the other posture is steady", () => {
    const l = new PostureLatch("seated");
    let t = 0;
    for (; t < SWITCH_AFTER_MS - 100; t += 100) expect(l.update("standing", t)).toBe("seated");
    for (; t < SWITCH_AFTER_MS + 300; t += 100) l.update("standing", t);
    expect(l.get()).toBe("standing");
  });

  it("'unknown' (legs hidden) keeps the last posture", () => {
    const l = new PostureLatch("standing");
    for (let t = 0; t < 10000; t += 100) l.update("unknown", t);
    expect(l.get()).toBe("standing");
  });
});

import { RiseDetector, RISE_TORSOS } from "@/lib/pose/postureLatch";

describe("RiseDetector (standing up with the knees out of the picture)", () => {
  const torso = 0.3;
  it("reads standing when the shoulders rise most of a torso, and the guide follows", () => {
    const d = new RiseDetector();
    const l = new PostureLatch("seated");
    let t = 0;
    // Seated, legs seen: learns where the shoulders sit.
    for (; t < 2000; t += 33) l.update(d.read("seated", l.get(), 0.4, torso), t);
    // Stands up; the knees leave the picture (legs unknown), shoulders 0.75 torso higher.
    for (; t < 2000 + 1500; t += 33) l.update(d.read("unknown", l.get(), 0.4 - ((t - 2000) / 1500) * 0.225, torso), t);
    for (; t < 12000; t += 33) l.update(d.read("unknown", l.get(), 0.175, torso), t);
    expect(l.get()).toBe("standing");
    // Sits back down: shoulders drop again.
    for (; t < 22000; t += 33) l.update(d.read("unknown", l.get(), 0.4, torso), t);
    expect(l.get()).toBe("seated");
  });

  it("ignores a raised arm's shrug, a lean, and drifting a little nearer", () => {
    const d = new RiseDetector();
    const l = new PostureLatch("seated");
    let t = 0;
    for (; t < 2000; t += 33) l.update(d.read("seated", l.get(), 0.4, torso), t);
    for (; t < 60000; t += 33) {
      const y = 0.4 - 0.1 * torso * Math.sin(t / 800) - (t / 60000) * 0.03; // shrug + slow drift
      l.update(d.read("unknown", l.get(), y, torso), t);
    }
    expect(l.get()).toBe("seated");
    expect(RISE_TORSOS).toBeGreaterThan(0.3);
  });

  it("the leg reading wins when there is one", () => {
    const d = new RiseDetector();
    d.read("seated", "seated", 0.4, torso);
    expect(d.read("seated", "seated", 0.1, torso)).toBe("seated");
  });
});
