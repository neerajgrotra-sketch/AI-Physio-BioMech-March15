import { describe, expect, it } from "vitest";
import { reachLineY } from "@/lib/pose/reachGuide";
import { FlexionViewEstimator } from "@/lib/biomechanics/flexionView";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { flexionFront, frameFromPixels } from "@/lib/testing/poses";

describe("reachLineY: the elbow target facing the camera", () => {
  it("sits where the elbow is when the arm is at the target angle", () => {
    const est = new FlexionViewEstimator();
    for (let i = 0; i < 30; i++) est.apply(extractMovementFeatures(frameFromPixels(flexionFront(3))));
    const L = est.armLength("right");
    for (const target of [90, 110, 140]) {
      const y = reachLineY(frameFromPixels(flexionFront(3)), "right", L, target)!;
      const elbowAtTarget = flexionFront(target).right_elbow!.y / 720;
      // Within 3% of the frame height.
      expect(Math.abs(y - elbowAtTarget), `target ${target}°`).toBeLessThan(0.03);
    }
  });

  it("is null until the arm length is known", () => {
    expect(reachLineY(frameFromPixels(flexionFront(3)), "right", null, 110)).toBeNull();
  });
});

import { handTargetPoint, handInTarget } from "@/lib/pose/reachGuide";
describe("hand target (testers: show where the hand must reach)", () => {
  const arm = 0.6; // upper arm in torso lengths
  it("level (90°) puts the hand target at shoulder height; above level, higher than the shoulder", () => {
    const f = frameFromPixels(flexionFront(20));
    const sh = (f.landmarks as any).right_shoulder;
    expect(handTargetPoint(f, "right", arm, 90)!.y).toBeCloseTo(sh.y, 5);
    expect(handTargetPoint(f, "right", arm, 130)!.y).toBeLessThan(sh.y);
    expect(handTargetPoint(f, "right", arm, 160)!.y).toBeLessThan(handTargetPoint(f, "right", arm, 130)!.y);
  });
  it("a hand resting low is outside the circle", () => {
    const f = frameFromPixels(flexionFront(20));
    expect(handInTarget(f, "right", handTargetPoint(f, "right", arm, 130)!)).toBe(false);
  });
  it("unknown arm length or no shoulder: no target", () => {
    const f = frameFromPixels(flexionFront(20));
    expect(handTargetPoint(f, "right", null, 130)).toBeNull();
  });
});

describe("hand target: a straight arm at the target lands in the circle", () => {
  it("at 110°, 130° and 150°, close to the camera and 2.5 m away", () => {
    const arm = extractMovementFeatures(frameFromPixels(flexionFront(5))).rightUpperArmReach!;
    for (const d of [110, 130, 150]) for (const camPx of [6800, 2500]) {
      const f = frameFromPixels(flexionFront(d, { camPx }));
      expect(handInTarget(f, "right", handTargetPoint(f, "right", arm, d)!)).toBe(true);
    }
  });
});
