// ============================================================
// lib/biomechanics/world3d.ts
// ============================================================
// EXPERIMENT (backlog: "3D depth from the webcam"). BlazePose also returns
// keypoints3D: each joint in metres, hip-centred, with an estimated depth
// (z). From it the arm's elevation and its direction around the body
// (forward or out to the side) can be read directly, with no foreshortening
// workaround. Logged on the TRACE line next to the 2D method. The owner's
// first real run (2026-11-26) showed the 3D plane tells forward (~30-38°)
// from sideways (~80-90°) cleanly where the 2D estimate wrongly failed two
// forward reps, so the FORM checks (plane, bent elbow) now use 3D when it
// is available (applyWorld3DForm); the elevation that counts reps is still
// the 2D one until a check run says which is closer.
//
// Body frame (so a leaning trunk doesn't skew it): "down" runs from the
// shoulder centre to the hip centre, "across" from the right shoulder to
// the left, "forward" is perpendicular to both, toward the camera.
// Pure. Tested by world3d.test.ts.
// ============================================================

export type V3 = { x: number; y: number; z: number; score?: number };

// BlazePose's 33-point indices.
const IDX = { left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14, left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24 };

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 | null => {
  const m = Math.sqrt(dot(a, a));
  return m < 1e-6 ? null : mul(a, 1 / m);
};
const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;

/** elbowDeg: the interior elbow angle (180 = straight), null if the wrist isn't seen. */
export type Arm3D = { elevDeg: number; planeDeg: number | null; elbowDeg: number | null };

/**
 * The arm's elevation (0 down, 90 level, 180 up) and plane (0 in front,
 * 90 out to the side; null near straight down or up, where it is
 * undefined), from BlazePose keypoints3D. Null if a joint is missing or
 * unsure.
 */
export function arm3D(kp: V3[] | undefined | null, side: "right" | "left", minScore = 0.5): Arm3D | null {
  if (!kp || kp.length < 25) return null;
  const get = (i: number) => (kp[i] && (kp[i].score ?? 1) >= minScore ? kp[i] : null);
  const lS = get(IDX.left_shoulder), rS = get(IDX.right_shoulder), lH = get(IDX.left_hip), rH = get(IDX.right_hip);
  const sh = side === "right" ? rS : lS;
  const el = get(side === "right" ? IDX.right_elbow : IDX.left_elbow);
  if (!lS || !rS || !lH || !rH || !sh || !el) return null;

  const shMid = mul(add(lS, rS), 0.5), hipMid = mul(add(lH, rH), 0.5);
  const down = norm(sub(hipMid, shMid));
  if (!down) return null;
  const acrossRaw = sub(lS, rS);
  const across = norm(sub(acrossRaw, mul(down, dot(acrossRaw, down))));
  if (!across) return null;
  let fwd = norm(cross(down, across));
  if (!fwd) return null;
  // Forward is toward the camera (BlazePose: smaller z is nearer the camera).
  if (fwd.z > 0) fwd = mul(fwd, -1);

  const arm = norm(sub(el, sh));
  if (!arm) return null;
  const elevDeg = deg(Math.acos(Math.max(-1, Math.min(1, dot(arm, down)))));
  const f = dot(arm, fwd);
  const s = Math.abs(dot(arm, across));
  const planeDeg = Math.hypot(f, s) < 0.35 ? null : deg(Math.atan2(s, f));
  const wr = get(side === "right" ? IDX.right_wrist : IDX.left_wrist);
  const fore = wr ? norm(sub(wr, el)) : null;
  const elbowDeg = fore ? deg(Math.acos(Math.max(-1, Math.min(1, -dot(arm, fore))))) : null;
  return { elevDeg, planeDeg, elbowDeg };
}

// A straight arm's elbow reads above this (interior angle).
export const STRAIGHT_ELBOW_DEG = 140;

/**
 * Overwrites the form fields (plane, bent elbow) on the features with the
 * 3D reading where it has one; keeps the 2D values otherwise. In place.
 * Only facing the camera (when the 2D form fields are being set).
 */
export function applyWorld3DForm(
  f: {
    rightArmPlaneDeg: number | null; leftArmPlaneDeg: number | null;
    rightElbowBent: boolean | null; leftElbowBent: boolean | null;
  },
  w: { right: Arm3D | null; left: Arm3D | null },
  facing: "front" | "side" | null
): void {
  if (facing !== "front") return;
  const one = (a: Arm3D | null, side: "right" | "left") => {
    if (!a) return;
    const inRange = a.elevDeg >= 30 && a.elevDeg <= 150;
    if (side === "right") {
      f.rightArmPlaneDeg = a.planeDeg;
      if (a.elbowDeg !== null) f.rightElbowBent = inRange ? a.elbowDeg < STRAIGHT_ELBOW_DEG : null;
    } else {
      f.leftArmPlaneDeg = a.planeDeg;
      if (a.elbowDeg !== null) f.leftElbowBent = inRange ? a.elbowDeg < STRAIGHT_ELBOW_DEG : null;
    }
  };
  one(w.right, "right");
  one(w.left, "left");
}
