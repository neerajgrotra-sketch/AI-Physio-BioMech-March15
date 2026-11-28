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

