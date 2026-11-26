// ============================================================
// lib/biomechanics/world3d.ts
// ============================================================
// EXPERIMENT (backlog: "3D depth from the webcam"). BlazePose also returns
// keypoints3D: each joint in metres, hip-centred, with an estimated depth
// (z). From it the arm's elevation and its direction around the body
// (forward or out to the side) can be read directly, with no foreshortening
// workaround. For now this is only LOGGED next to the 2D method (the TRACE
// line in session_debug_logs), so the two can be compared on real
// movement before anything is scored with it.
//
// Body frame (so a leaning trunk doesn't skew it): "down" runs from the
// shoulder centre to the hip centre, "across" from the right shoulder to
// the left, "forward" is perpendicular to both, toward the camera.
// Pure. Tested by world3d.test.ts.
// ============================================================

export type V3 = { x: number; y: number; z: number; score?: number };

// BlazePose's 33-point indices.
const IDX = { left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14, left_hip: 23, right_hip: 24 };

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

export type Arm3D = { elevDeg: number; planeDeg: number | null };

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
  return { elevDeg, planeDeg };
}
