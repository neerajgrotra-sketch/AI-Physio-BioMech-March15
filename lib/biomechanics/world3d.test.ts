import { describe, expect, it } from "vitest";
import { arm3D, type V3 } from "@/lib/biomechanics/world3d";

// A body in BlazePose world coordinates (metres, y down, smaller z nearer
// the camera), facing the camera, right arm at `elev` from down, swung
// `out` degrees from straight in front toward the side.
function body(elev: number, out: number, lean = 0): V3[] {
  const kp: V3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, score: 1 }));
  const r = (d: number) => (d * Math.PI) / 180;
  const lk = Math.sin(r(lean)); // trunk leaning forward a little
  kp[11] = { x: 0.18, y: -0.5, z: -lk * 0.5, score: 1 };  // left shoulder (image right)
  kp[12] = { x: -0.18, y: -0.5, z: -lk * 0.5, score: 1 }; // right shoulder
  kp[23] = { x: 0.1, y: 0, z: 0, score: 1 };
  kp[24] = { x: -0.1, y: 0, z: 0, score: 1 };
  const L = 0.3;
  // Right arm: down = +y, forward = -z, outward (patient's right) = -x.
  const e = r(elev), o = r(out);
  const dir = { x: -Math.sin(e) * Math.sin(o), y: Math.cos(e), z: -Math.sin(e) * Math.cos(o) };
  kp[14] = { x: kp[12].x + dir.x * L, y: kp[12].y + dir.y * L, z: kp[12].z + dir.z * L, score: 1 };
  kp[13] = { x: 0.2, y: -0.2, z: 0, score: 1 };
  return kp;
}

describe("arm3D (BlazePose keypoints3D experiment)", () => {
  it("reads elevation for a forward raise", () => {
    for (const e of [30, 90, 120, 160]) {
      expect(Math.abs(arm3D(body(e, 0), "right")!.elevDeg - e), `at ${e}°`).toBeLessThan(1);
    }
  });

  it("tells forward from out to the side at the same height", () => {
    expect(arm3D(body(100, 0), "right")!.planeDeg!).toBeLessThan(5);
    expect(arm3D(body(100, 90), "right")!.planeDeg!).toBeGreaterThan(85);
    expect(Math.abs(arm3D(body(100, 30), "right")!.planeDeg! - 30)).toBeLessThan(2);
  });

  it("no plane when the arm hangs straight down", () => {
    expect(arm3D(body(5, 0), "right")!.planeDeg).toBeNull();
  });

  it("missing joints give null", () => {
    expect(arm3D(undefined, "right")).toBeNull();
    const kp = body(90, 0);
    kp[14] = { ...kp[14], score: 0.1 };
    expect(arm3D(kp, "right")).toBeNull();
  });
});
