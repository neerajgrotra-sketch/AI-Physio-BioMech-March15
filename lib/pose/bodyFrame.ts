// lib/pose/bodyFrame.ts
// Body-relative coordinate frame extracted from live skeleton landmarks.
// Shared by PoseDemoRunner and SessionRunner — single source of truth.
//
// COORDINATE SYSTEM:
//   origin   = shoulder midpoint in canvas pixels
//   axisDown = unit vector from shoulder-mid toward hip-mid (spine direction)
//   axisRight = unit vector toward patient anatomical RIGHT (canvas-left after mirror)
//
//   framePoint(f, along, across):
//     along  > 0  = toward feet
//     along  < 0  = above shoulders (overhead positions)
//     across > 0  = patient's RIGHT side
//     across < 0  = patient's LEFT side

export type Vec2 = { x: number; y: number };
export type Landmark = { x: number; y: number; z: number; visibility?: number };

// BlazePose landmark indices
export const LP = {
  LEFT_SHOULDER:  11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW:     13, RIGHT_ELBOW:    14,
  LEFT_WRIST:     15, RIGHT_WRIST:    16,
  LEFT_HIP:       23, RIGHT_HIP:      24,
  LEFT_KNEE:      25, RIGHT_KNEE:     26,
  LEFT_ANKLE:     27, RIGHT_ANKLE:    28,
} as const;

export type BodyFrame = {
  origin: Vec2;
  axisDown: Vec2;
  axisRight: Vec2;
  torsoLen: number;
  shoulderWidth: number;
  rUpperArm: number; rForeArm: number;
  lUpperArm: number; lForeArm: number;
  rThigh: number;    rShin: number;
  lThigh: number;    lShin: number;
};

// ─── Math helpers ─────────────────────────────────────────────────────────────

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function norm(v: Vec2): Vec2 {
  const m = Math.sqrt(v.x ** 2 + v.y ** 2);
  return m < 0.001 ? { x: 0, y: 1 } : { x: v.x / m, y: v.y / m };
}

export function vis(lm: Landmark | undefined): boolean {
  return !!lm && (lm.visibility ?? 1) > 0.25;
}

export function toCanvas(lm: Landmark, w: number, h: number): Vec2 {
  return { x: lm.x * w, y: lm.y * h };
}

export function segLen(
  lms: Landmark[], a: number, b: number,
  w: number, h: number, fallback: number
): number {
  if (!vis(lms[a]) || !vis(lms[b])) return fallback;
  return Math.max(dist(toCanvas(lms[a], w, h), toCanvas(lms[b], w, h)), 10);
}

// ─── Body frame extraction ────────────────────────────────────────────────────

export function getBodyFrame(lms: Landmark[], w: number, h: number): BodyFrame | null {
  const ls = lms[LP.LEFT_SHOULDER];
  const rs = lms[LP.RIGHT_SHOULDER];
  if (!vis(ls) || !vis(rs)) return null;

  const lsC = toCanvas(ls, w, h);
  const rsC = toCanvas(rs, w, h);
  const shoulderMid: Vec2 = { x: (lsC.x + rsC.x) / 2, y: (lsC.y + rsC.y) / 2 };
  const shoulderWidth = Math.max(dist(lsC, rsC), 20);

  // axisRight: after mirroring, patient RIGHT = rsC -> lsC direction
  const axisRight = norm({ x: rsC.x - lsC.x, y: rsC.y - lsC.y });
  // axisDown: perpendicular, always pointing toward bottom of frame
  let axisDown: Vec2 = { x: -axisRight.y, y: axisRight.x };
  if (axisDown.y < 0) axisDown = { x: -axisDown.x, y: -axisDown.y };

  const lh = lms[LP.LEFT_HIP];
  const rh = lms[LP.RIGHT_HIP];
  let torsoLen: number;
  if (vis(lh) && vis(rh)) {
    const lhC = toCanvas(lh, w, h);
    const rhC = toCanvas(rh, w, h);
    const hipMid: Vec2 = { x: (lhC.x + rhC.x) / 2, y: (lhC.y + rhC.y) / 2 };
    torsoLen = Math.max(dist(shoulderMid, hipMid), 20);
  } else {
    torsoLen = shoulderWidth * 1.4;
  }

  return {
    origin: shoulderMid, axisDown, axisRight, torsoLen, shoulderWidth,
    rUpperArm: segLen(lms, LP.RIGHT_SHOULDER, LP.RIGHT_ELBOW, w, h, shoulderWidth * 0.8),
    rForeArm:  segLen(lms, LP.RIGHT_ELBOW,    LP.RIGHT_WRIST, w, h, shoulderWidth * 0.7),
    lUpperArm: segLen(lms, LP.LEFT_SHOULDER,  LP.LEFT_ELBOW,  w, h, shoulderWidth * 0.8),
    lForeArm:  segLen(lms, LP.LEFT_ELBOW,     LP.LEFT_WRIST,  w, h, shoulderWidth * 0.7),
    rThigh:    segLen(lms, LP.RIGHT_HIP,      LP.RIGHT_KNEE,  w, h, torsoLen * 0.55),
    rShin:     segLen(lms, LP.RIGHT_KNEE,     LP.RIGHT_ANKLE, w, h, torsoLen * 0.5),
    lThigh:    segLen(lms, LP.LEFT_HIP,       LP.LEFT_KNEE,   w, h, torsoLen * 0.55),
    lShin:     segLen(lms, LP.LEFT_KNEE,      LP.LEFT_ANKLE,  w, h, torsoLen * 0.5),
  };
}

// ─── Point placement helpers ──────────────────────────────────────────────────

// Place a point using spine-frame coordinates.
// along  = fraction of torsoLen along axisDown
// across = fraction of shoulderWidth along axisRight
export function framePoint(f: BodyFrame, along: number, across: number): Vec2 {
  return {
    x: f.origin.x + f.axisDown.x * along * f.torsoLen + f.axisRight.x * across * f.shoulderWidth,
    y: f.origin.y + f.axisDown.y * along * f.torsoLen + f.axisRight.y * across * f.shoulderWidth,
  };
}

// Place a limb endpoint from a start point, direction vector, and length.
export function limbPoint(
  f: BodyFrame, from: Vec2,
  alongDir: number, acrossDir: number, len: number
): Vec2 {
  const mag = Math.sqrt(alongDir ** 2 + acrossDir ** 2) || 1;
  const ad = alongDir / mag;
  const ac = acrossDir / mag;
  return {
    x: from.x + (f.axisDown.x * ad + f.axisRight.x * ac) * len,
    y: from.y + (f.axisDown.y * ad + f.axisRight.y * ac) * len,
  };
}

// ─── Joint angle scoring (2D) ────────────────────────────────────────────────

export function angleBetween(a: Vec2, b: Vec2, c: Vec2): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const mag = Math.sqrt(ba.x ** 2 + ba.y ** 2) * Math.sqrt(bc.x ** 2 + bc.y ** 2);
  return mag < 0.001 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

// ─── Lerp utilities ───────────────────────────────────────────────────────────

export function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
