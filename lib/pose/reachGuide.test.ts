import { describe, expect, it } from "vitest";
import { reachLineY } from "@/lib/pose/reachGuide";
import { FlexionViewEstimator } from "@/lib/biomechanics/flexionView";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { flexionFront, frameFromPixels } from "@/lib/testing/poses";

describe("reachLineY: the 'Reach here' line facing the camera", () => {
  it("sits where the hand is when the arm is at the target angle", () => {
    const est = new FlexionViewEstimator();
    for (let i = 0; i < 30; i++) est.apply(extractMovementFeatures(frameFromPixels(flexionFront(3))));
    const L = est.armLength("right");
    for (const target of [90, 110, 140]) {
      const y = reachLineY(frameFromPixels(flexionFront(3)), "right", L, target)!;
      const handAtTarget = flexionFront(target).right_wrist!.y / 720;
      // Within 4% of the frame height (perspective makes the real hand a bit higher).
      expect(Math.abs(y - handAtTarget), `target ${target}°`).toBeLessThan(0.04);
    }
  });

  it("is null until the arm length is known", () => {
    expect(reachLineY(frameFromPixels(flexionFront(3)), "right", null, 110)).toBeNull();
  });
});
