// Front-view shoulder flexion: the arm raised toward the camera, worked out
// from the elbow's height and the learned arm length (flexionView.ts).
import { describe, expect, it } from "vitest";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import { smoothMovementFeatures } from "@/lib/biomechanics/smoothMovementFeatures";
import { elevationFromDrop, FlexionViewEstimator } from "@/lib/biomechanics/flexionView";
import { flexionFront, flexionSide, frameFromPixels, place, type PixelBody } from "@/lib/testing/poses";
import { FeatureHistory } from "@/lib/pose/poseFrameHistory";

/** Runs bodies through extract -> smoothing -> estimator, as the loop does. */
function run(bodies: PixelBody[], w = 1280, h = 720) {
  const est = new FlexionViewEstimator();
  const hist = new FeatureHistory(5);
  return bodies.map((b, i) => {
    hist.push(extractMovementFeatures(frameFromPixels(b, w, h, { timestamp: i * 33 })));
    const f = smoothMovementFeatures(hist.getAll());
    est.apply(f);
    return { f, view: est.currentView() };
  });
}

const repeat = (b: PixelBody, n: number) => Array.from({ length: n }, () => b);

/** Rest for 2 s, then hold `deg` for 1 s; the reading at the end. */
function readAt(deg: number, opts: Parameters<typeof flexionFront>[1] = {}, w = 1280, h = 720) {
  const out = run([...repeat(flexionFront(3, opts), 60), ...repeat(flexionFront(deg, opts), 30)], w, h);
  return out[out.length - 1];
}

describe("elevationFromDrop", () => {
  it("is the angle whose cosine is drop / length", () => {
    expect(elevationFromDrop(1, 1)).toBe(0);
    expect(elevationFromDrop(0, 1)).toBe(90);
    expect(elevationFromDrop(-1, 1)).toBe(180);
    expect(elevationFromDrop(0.5, 1)).toBe(60);
    expect(elevationFromDrop(2, 1)).toBe(0); // clamped
  });
});

describe("facing the camera, an arm raised forward", () => {
  it("the old 2D angle could not see it (why front view used to be refused)", () => {
    const f = extractMovementFeatures(frameFromPixels(flexionFront(60)));
    expect(f.rightArmElevationDeg).toBeLessThan(5); // the arm only looks shorter
  });

  it("reads within 6° from 20° to 140°, standing", () => {
    for (const deg of [20, 45, 70, 90, 110, 125, 140]) {
      const r = readAt(deg);
      expect(r.view).toBe("front");
      expect(Math.abs(r.f.rightArmElevationDeg! - deg), `at ${deg}°`).toBeLessThanOrEqual(6);
    }
  });

  it("reads within 10° near overhead (160°, 175°)", () => {
    for (const deg of [160, 175]) {
      expect(Math.abs(readAt(deg).f.rightArmElevationDeg! - deg), `at ${deg}°`).toBeLessThanOrEqual(10);
    }
  });

  it("works seated too", () => {
    for (const deg of [45, 90, 120, 150]) {
      expect(Math.abs(readAt(deg, { seated: true }).f.rightArmElevationDeg! - deg), `at ${deg}°`).toBeLessThanOrEqual(8);
    }
  });

  it("an arm that also drifts 20° out to the side still reads its height", () => {
    for (const deg of [60, 110, 140]) {
      expect(Math.abs(readAt(deg, { outDeg: 20 }).f.rightArmElevationDeg! - deg), `at ${deg}°`).toBeLessThanOrEqual(7);
    }
  });

  it("the left arm, and both arms", () => {
    expect(Math.abs(readAt(110, { side: "left" }).f.leftArmElevationDeg! - 110)).toBeLessThanOrEqual(6);
    const both = readAt(120, { side: "both" }).f;
    expect(Math.abs(both.rightArmElevationDeg! - 120)).toBeLessThanOrEqual(6);
    expect(Math.abs(both.leftArmElevationDeg! - 120)).toBeLessThanOrEqual(6);
  });

  it("the resting arm stays near 0 (so the isolation check still works)", () => {
    const r = readAt(130);
    expect(r.f.leftArmElevationDeg!).toBeLessThan(15);
  });

  it("stepping closer to the camera mid-exercise changes nothing", () => {
    const near = (deg: number) => place(flexionFront(deg), 1.3, 640, 380);
    const out = run([...repeat(flexionFront(3), 60), ...repeat(near(3), 30), ...repeat(near(110), 30)]);
    expect(Math.abs(out[out.length - 1].f.rightArmElevationDeg! - 110)).toBeLessThanOrEqual(6);
  });

  it("works on a portrait (tablet, phone) camera", () => {
    const portrait = (deg: number) => place(flexionFront(deg), 0.9, 360, 640);
    const out = run([...repeat(portrait(3), 60), ...repeat(portrait(110), 30)], 720, 1280);
    expect(Math.abs(out[out.length - 1].f.rightArmElevationDeg! - 110)).toBeLessThanOrEqual(6);
  });

  it("gives no reading until it has seen the arm for a moment", () => {
    const out = run(repeat(flexionFront(3), 5));
    expect(out[4].f.rightArmElevationDeg).toBeNull();
  });
});

describe("side on, the plain angle is kept", () => {
  it("reads the side-view angle unchanged", () => {
    const out = run([...repeat(flexionSide(5), 30), ...repeat(flexionSide(120), 30)]);
    const last = out[out.length - 1];
    expect(last.view).toBe("side");
    expect(Math.abs(last.f.rightArmElevationDeg! - 120)).toBeLessThanOrEqual(2);
  });

  it("switches view when the patient turns, and both views agree", () => {
    const out = run([...repeat(flexionFront(3), 60), ...repeat(flexionFront(100), 30), ...repeat(flexionSide(100), 30)]);
    expect(out[89].view).toBe("front");
    expect(out[119].view).toBe("side");
    expect(Math.abs(out[89].f.rightArmElevationDeg! - out[119].f.rightArmElevationDeg!)).toBeLessThanOrEqual(6);
  });
});

describe("with webcam-like tracking jitter", () => {
  // BlazePose landmarks wobble a few pixels from frame to frame.
  const jitter = (b: PixelBody, seed: number, px = 4): PixelBody => {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 2 - 1;
    const out: PixelBody = {};
    for (const [k, p] of Object.entries(b)) (out as any)[k] = { x: p!.x + rnd() * px, y: p!.y + rnd() * px };
    return out;
  };

  it("±4 px jitter: within 8° to 140°, 12° near overhead", () => {
    const rows: string[] = [];
    for (const deg of [30, 60, 90, 110, 140, 160]) {
      const bodies = [
        ...Array.from({ length: 90 }, (_, i) => jitter(flexionFront(3), i)),
        ...Array.from({ length: 45 }, (_, i) => jitter(flexionFront(deg), 1000 + i)),
      ];
      const out = run(bodies).slice(-30).map((o) => o.f.rightArmElevationDeg!);
      const worst = Math.max(...out.map((v) => Math.abs(v - deg)));
      rows.push(`${deg}°: worst ${worst.toFixed(1)}°`);
      expect(worst, `at ${deg}°`).toBeLessThanOrEqual(deg >= 150 ? 12 : 8);
    }
    console.log("front-view error with jitter: " + rows.join(", "));
  });
});
