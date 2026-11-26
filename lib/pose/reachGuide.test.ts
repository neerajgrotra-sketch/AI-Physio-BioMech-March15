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
