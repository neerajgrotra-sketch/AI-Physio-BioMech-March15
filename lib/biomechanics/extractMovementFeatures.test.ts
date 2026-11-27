import { describe, expect, it } from "vitest";
import { extractMovementFeatures, inferPosture } from "@/lib/biomechanics/extractMovementFeatures";
import {
  flexionSide, frameFromPixels, seatedFront, seatedSide, standingFront, standingSide,
} from "@/lib/testing/poses";

const near = (actual: number | null, expected: number, within = 1) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(within);
};

describe("angles are true on any camera shape", () => {
  // Before the fix, a 16:9 frame read 45° as 29° and 135° as 151°.
  for (const deg of [15, 45, 70, 90, 110, 135, 160]) {
    it(`abduction ${deg}° reads ${deg}° on 16:9 landscape`, () => {
      const f = extractMovementFeatures(frameFromPixels(standingFront({ rightArmDeg: deg }), 1280, 720));
      near(f.rightShoulderAbductionDeg, deg);
      near(f.rightArmElevationDeg, deg);
    });
  }

  it("same body on a portrait phone (720x1280) reads the same angle", () => {
    // Shift the body into a portrait frame; pixel geometry is unchanged.
    const body = standingFront({ leftArmDeg: 45, cx: 360 });
    const f = extractMovementFeatures(frameFromPixels(body, 720, 1280));
    near(f.leftShoulderAbductionDeg, 45);
  });

  it("flexion seen from the side reads the forward raise", () => {
    for (const deg of [20, 90, 150]) {
      near(extractMovementFeatures(frameFromPixels(flexionSide(deg))).rightArmElevationDeg, deg);
    }
  });
});

describe("knees", () => {
  it("seated side view: knee angle follows the leg", () => {
    near(extractMovementFeatures(frameFromPixels(seatedSide(90))).kneeAngleRight, 90);
    near(extractMovementFeatures(frameFromPixels(seatedSide(150))).kneeAngleRight, 150);
    near(extractMovementFeatures(frameFromPixels(seatedSide(178))).kneeAngleRight, 178);
  });
});

describe("posture", () => {
  it("standing, front and side", () => {
    expect(extractMovementFeatures(frameFromPixels(standingFront())).posture).toBe("standing");
    expect(extractMovementFeatures(frameFromPixels(standingSide())).posture).toBe("standing");
  });

  it("seated from the side (knee bent)", () => {
    expect(extractMovementFeatures(frameFromPixels(seatedSide(90))).posture).toBe("seated");
  });

  it("seated from the FRONT, where the 2D knee angle looks straight", () => {
    const f = extractMovementFeatures(frameFromPixels(seatedFront()));
    expect(f.kneeAngleRight).toBeGreaterThan(150); // the trap the old code fell into
    expect(f.posture).toBe("seated");
  });

  it("seated from the front with the ankles out of frame (the usual home set-up): still seated", () => {
    const body = seatedFront();
    const noAnkles = { ...body, right_ankle: { x: 585, y: 790 }, left_ankle: { x: 695, y: 790 } }; // below the 720 px frame
    expect(extractMovementFeatures(frameFromPixels(noAnkles)).posture).toBe("seated");
  });

  it("from the front, a guessed knee below the frame's edge never reads as standing", () => {
    const body = seatedFront();
    const guessed = { ...body, right_knee: { x: 585, y: 730 }, left_knee: { x: 695, y: 730 }, right_ankle: { x: 585, y: 900 }, left_ankle: { x: 695, y: 900 } };
    expect(extractMovementFeatures(frameFromPixels(guessed)).posture).not.toBe("standing");
  });

  it("works from one leg", () => {
    expect(inferPosture([null, 90], [null, null])).toBe("seated");
    expect(inferPosture([175, null], [1.0, null])).toBe("standing");
    expect(inferPosture([null, null], [null, null])).toBe("unknown");
  });
});

describe("trunk and shoulders", () => {
  it("level shoulders read 0° tilt (used to read ~180°)", () => {
    near(extractMovementFeatures(frameFromPixels(standingFront())).shoulderTiltDeg, 0);
  });

  it("tilted shoulders read the tilt", () => {
    const b = standingFront();
    const dy = Math.tan((10 * Math.PI) / 180) * 140;
    b.right_shoulder = { x: b.right_shoulder!.x, y: b.right_shoulder!.y + dy };
    near(extractMovementFeatures(frameFromPixels(b)).shoulderTiltDeg, 10);
  });

  it("looking up at a raised hand is not a trunk lean", () => {
    const b = standingFront({ rightArmDeg: 160 });
    b.nose = { x: b.nose!.x - 60, y: b.nose!.y + 10 }; // head turned and tipped
    near(extractMovementFeatures(frameFromPixels(b)).torsoLeanDeg, 0, 2);
  });
});

describe("confidence and precision", () => {
  it("low-confidence landmarks are ignored, not measured", () => {
    const f = extractMovementFeatures(
      frameFromPixels(standingFront({ rightArmDeg: 90 }), 1280, 720, { scores: { right_elbow: 0.1, right_wrist: 0.1 } })
    );
    expect(f.rightArmElevationDeg).toBeNull();
    expect(f.rightShoulderAbductionDeg).toBeNull();
  });

  it("hip height keeps its precision (used to round to 0.1 of the frame)", () => {
    const f = extractMovementFeatures(frameFromPixels(standingFront()));
    expect(f.hipCenterY).toBeCloseTo(430 / 720, 3);
  });

  it("no person -> empty features", () => {
    const f = extractMovementFeatures({ timestamp: 0, landmarks: {}, personDetected: false });
    expect(f.posture).toBe("unknown");
    expect(f.rightArmElevationDeg).toBeNull();
  });
});
