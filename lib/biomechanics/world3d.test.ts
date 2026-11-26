import { describe, expect, it } from "vitest";
import { applyWorld3DForm, arm3D, type V3 } from "@/lib/biomechanics/world3d";

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

describe("3D form: elbow angle and applying it to the features", () => {
  const withWrist = (elev: number, elbowBendDeg: number) => {
    const kp = body(elev, 0);
    // Forearm continues the upper arm, bent by elbowBendDeg upward/forward.
    const sh = kp[12], el = kp[14];
    const ux = (el.x - sh.x) / 0.3, uy = (el.y - sh.y) / 0.3, uz = (el.z - sh.z) / 0.3;
    const b = (elbowBendDeg * Math.PI) / 180;
    // Rotate the upper-arm direction toward "up" (−y) by the bend.
    const fx = ux, fy = uy * Math.cos(b) - Math.sin(b), fz = uz * Math.cos(b);
    const m = Math.hypot(fx, fy, fz);
    kp[16] = { x: el.x + (fx / m) * 0.27, y: el.y + (fy / m) * 0.27, z: el.z + (fz / m) * 0.27, score: 1 };
    return kp;
  };

  it("reads a straight elbow as about 180°, a bent one much less", () => {
    expect(arm3D(withWrist(90, 0), "right")!.elbowDeg!).toBeGreaterThan(170);
    expect(arm3D(withWrist(90, 80), "right")!.elbowDeg!).toBeLessThan(140);
  });

  it("applyWorld3DForm overrides the 2D form only facing the camera", () => {
    const f = { rightArmPlaneDeg: 70, leftArmPlaneDeg: null, rightElbowBent: false, leftElbowBent: null } as any;
    const w = { right: arm3D(withWrist(100, 80), "right"), left: null };
    applyWorld3DForm(f, w, "side");
    expect(f.rightArmPlaneDeg).toBe(70);       // side on: untouched
    applyWorld3DForm(f, w, "front");
    expect(f.rightArmPlaneDeg).toBeLessThan(10); // 3D says forward
    expect(f.rightElbowBent).toBe(true);         // and bent
  });
});
