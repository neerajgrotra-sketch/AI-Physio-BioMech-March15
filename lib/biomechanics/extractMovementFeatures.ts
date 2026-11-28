// ============================================================
// lib/biomechanics/extractMovementFeatures.ts
// ============================================================
// Turns one pose frame into the joint angles and body-state
// features the rep logic reads. Pure: no DOM, no React, no time.
// Tested by lib/biomechanics/extractMovementFeatures.test.ts.
//
// COORDINATES. PoseFrame landmarks are normalised separately by
// the video's width (x) and height (y), so one unit of x is not
// the same length as one unit of y. Angles computed straight from
// those numbers are wrong on any non-square camera (on a 16:9
// webcam a true 45° arm reads 29°, a true 135° reads 151°).
// toBodySpace() rescales x by width/height first, so every angle
// and distance below is measured in true image proportions, in
// units of the frame's height.
// ============================================================

import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame, PoseLandmark, PostureType } from "@/lib/types/pose";

// Below this BlazePose score a landmark is treated as not seen.
// BlazePose always returns all 33 points, guessing the hidden ones
// with a low score; using those guesses produced phantom angles.
export const MIN_LANDMARK_SCORE = 0.35;

type P = { x: number; y: number };

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dist(a: P, b: P): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function mid(a: P, b: P): P {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return round1(valid.reduce((sum, v) => sum + v, 0) / valid.length);
}

/** Interior angle at b of the path a-b-c, 0..180°. */
export function angleDeg(a: P, b: P, c: P): number | null {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magCB = Math.sqrt(cbx * cbx + cby * cby);
  if (magAB < 1e-6 || magCB < 1e-6) return null;

  const cosine = Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / (magAB * magCB)));
  return round1(toDegrees(Math.acos(cosine)));
}

/**
 * Angle of the segment from -> to, measured from straight down.
 * 0° = hanging down, 90° = horizontal, 180° = straight up.
 * Screen y grows downward. This is how a goniometer reads shoulder
 * flexion (side view) and shoulder abduction (front view).
 */
export function angleFromDownDeg(from: P, to: P): number | null {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag < 1e-6) return null;
  const cosine = Math.max(-1, Math.min(1, vy / mag));
  return round1(toDegrees(Math.acos(cosine)));
}

/**
 * Landmarks in true image proportions: x is rescaled by
 * width/height so that x and y share one unit (the frame height).
 * Low-confidence landmarks are dropped.
 */
export function toBodySpace(frame: PoseFrame): Partial<Record<string, P>> {
  const w = frame.sourceWidth ?? 0;
  const h = frame.sourceHeight ?? 0;
  const xScale = w > 0 && h > 0 ? w / h : 1;

  const out: Partial<Record<string, P>> = {};
  for (const [name, lm] of Object.entries(frame.landmarks) as Array<[string, PoseLandmark | undefined]>) {
    if (!lm) continue;
    if (typeof lm.score === "number" && lm.score < MIN_LANDMARK_SCORE) continue;
    out[name] = { x: lm.x * xScale, y: lm.y };
  }
  return out;
}

/**
 * Upper-arm elevation (shoulder -> elbow) from straight down,
 * falling back to shoulder -> wrist when the elbow is not seen.
 * Shoulder flexion: valid from the SIDE (the arm moves toward a
 * front camera, which cannot see that). Shoulder abduction: valid
 * from the FRONT.
 */
function armElevationDeg(shoulder: P, elbow: P | null, wrist: P | null): number | null {
  const distal = elbow ?? wrist;
  if (!distal) return null;
  return angleFromDownDeg(shoulder, distal);
}

/**
 * Shoulder abduction from a front camera: the whole arm
 * (shoulder -> wrist) from straight down, falling back to the
 * elbow. With true proportions this is a plain angle; the old
 * shoulder-width workaround existed only because x and y were in
 * different units.
 */
function shoulderAbductionDeg(shoulder: P, wrist: P | null, elbow: P | null): number | null {
  const distal = wrist ?? elbow;
  if (!distal) return null;
  return angleFromDownDeg(shoulder, distal);
}

/**
 * Seated or standing, from either leg.
 *
 * Side view: the knee angle tells it (about 90° seated, 170°+ standing).
 * Front view: a seated thigh points at the camera, so the 2D knee angle
 * looks straight. But the thigh then looks much shorter than the shin
 * (foreshortened), so the thigh/shin length ratio tells it instead:
 * about 1 standing, well under 0.6 seated.
 */
// Facing the camera, a seated thigh points at the lens and looks short next
// to the torso; a standing thigh looks about as long as the torso. The knee
// angle means nothing from the front (hip, knee and ankle line up when
// seated, reading ~170°, "standing": the guide kept standing up mid-exercise
// in the owner's runs), and the ankles are often out of frame.
export const SEATED_THIGH_TORSO = 0.45;
export const STANDING_THIGH_TORSO = 0.6;

export function inferPosture(
  kneeAngles: Array<number | null>,
  thighShinRatios: Array<number | null>,
  front?: { facing: boolean; thighTorso: number | null }
): PostureType {
  const ratio = average(thighShinRatios);
  if (front?.facing) {
    const t = front.thighTorso;
    if (t !== null) {
      if (t < SEATED_THIGH_TORSO) return "seated";
      if (t > STANDING_THIGH_TORSO && (ratio === null || ratio > 0.75)) return "standing";
      return "unknown";
    }
    // No knees in frame: only the thigh/shin ratio can tell, and only "seated".
    return ratio !== null && ratio < 0.55 ? "seated" : "unknown";
  }
  const knee = average(kneeAngles);
  if (knee === null && ratio === null) return "unknown";

  const seatedByKnee = knee !== null && knee < 120;
  const seatedByRatio = ratio !== null && ratio < 0.55;
  if (seatedByKnee || seatedByRatio) return "seated";

  const standingByKnee = knee !== null && knee > 155;
  const legLooksFull = ratio === null || ratio > 0.75;
  if (standingByKnee && legLooksFull) return "standing";

  return "unknown";
}

export function emptyMovementFeatures(): MovementFeatures {
  return {
    posture: "unknown",
    rightArmElevationDeg: null,
    leftArmElevationDeg: null,
    bilateralArmElevationDeg: null,
    rightUpperArmDrop: null,
    rightUpperArmReach: null,
    leftUpperArmDrop: null,
    leftUpperArmReach: null,
    shoulderWidthRatio: null,
    rightUpperArmDropSw: null,
    rightUpperArmReachSw: null,
    leftUpperArmDropSw: null,
    leftUpperArmReachSw: null,
    rightWristDrop: null,
    leftWristDrop: null,
    rightElbowOut: null,
    leftElbowOut: null,
    rightWristDropSw: null,
    leftWristDropSw: null,
    rightElbowOutSw: null,
    leftElbowOutSw: null,
    rightArmPlaneDeg: null,
    leftArmPlaneDeg: null,
    rightElbowBent: null,
    leftElbowBent: null,
    rightShoulderAbductionDeg: null,
    leftShoulderAbductionDeg: null,
    bilateralShoulderAbductionDeg: null,
    rightElbowAngleDeg: null,
    leftElbowAngleDeg: null,
    torsoLeanDeg: null,
    shoulderTiltDeg: null,
    rightWristAboveShoulder: false,
    leftWristAboveShoulder: false,
    rightWristToShoulderDy: null,
    leftWristToShoulderDy: null,
    hipCenterY: null,
    hipHeightNormalized: null,
    kneeAngleLeft: null,
    kneeAngleRight: null,
    hipVelocityY: null,
    shoulderCenterY: null,
    torsoLength: null,
    isStanding: false,
    isSeated: false
  };
}

export function extractMovementFeatures(frame: PoseFrame): MovementFeatures {
  if (!frame.personDetected) return emptyMovementFeatures();

  const b = toBodySpace(frame);
  const get = (k: string): P | null => b[k] ?? null;

  const nose = get("nose");
  const lSh = get("left_shoulder");
  const rSh = get("right_shoulder");
  const lEl = get("left_elbow");
  const rEl = get("right_elbow");
  const lWr = get("left_wrist");
  const rWr = get("right_wrist");
  const lHip = get("left_hip");
  const rHip = get("right_hip");
  const lKn = get("left_knee");
  const rKn = get("right_knee");
  const lAn = get("left_ankle");
  const rAn = get("right_ankle");

  // ── Arms ──────────────────────────────────────────────────
  const rightArmElevationDeg = rSh ? armElevationDeg(rSh, rEl, rWr) : null;
  const leftArmElevationDeg = lSh ? armElevationDeg(lSh, lEl, lWr) : null;
  const bilateralArmElevationDeg = average([rightArmElevationDeg, leftArmElevationDeg]);

  // Upper-arm geometry in torso units, for the front-view flexion
  // estimate (see lib/biomechanics/flexionView.ts).
  const torsoMid = lHip && rHip ? mid(lHip, rHip) : null;
  const shMid0 = lSh && rSh ? mid(lSh, rSh) : null;
  const torsoLen = torsoMid && shMid0 ? dist(torsoMid, shMid0) : null;
  const perTorso = (v: number | null): number | null =>
    v === null || torsoLen === null || torsoLen < 1e-3 ? null : round3(v / torsoLen);
  const rightUpperArmDrop = rSh && rEl ? perTorso(rEl.y - rSh.y) : null;
  const rightUpperArmReach = rSh && rEl ? perTorso(dist(rSh, rEl)) : null;
  const leftUpperArmDrop = lSh && lEl ? perTorso(lEl.y - lSh.y) : null;
  const leftUpperArmReach = lSh && lEl ? perTorso(dist(lSh, lEl)) : null;
  const shoulderWidthRatio = lSh && rSh ? perTorso(Math.abs(lSh.x - rSh.x)) : null;
  const swLen = lSh && rSh ? Math.abs(lSh.x - rSh.x) : null;
  const perSw = (v: number | null): number | null =>
    v === null || swLen === null || swLen < 1e-3 ? null : round3(v / swLen);
  const rightUpperArmDropSw = rSh && rEl ? perSw(rEl.y - rSh.y) : null;
  const rightUpperArmReachSw = rSh && rEl ? perSw(dist(rSh, rEl)) : null;
  const leftUpperArmDropSw = lSh && lEl ? perSw(lEl.y - lSh.y) : null;
  const leftUpperArmReachSw = lSh && lEl ? perSw(dist(lSh, lEl)) : null;
  const rightWristDrop = rSh && rWr ? perTorso(rWr.y - rSh.y) : null;
  const leftWristDrop = lSh && lWr ? perTorso(lWr.y - lSh.y) : null;
  const rightElbowOut = rSh && rEl ? perTorso(Math.abs(rEl.x - rSh.x)) : null;
  const leftElbowOut = lSh && lEl ? perTorso(Math.abs(lEl.x - lSh.x)) : null;
  const rightWristDropSw = rSh && rWr ? perSw(rWr.y - rSh.y) : null;
  const leftWristDropSw = lSh && lWr ? perSw(lWr.y - lSh.y) : null;
  const rightElbowOutSw = rSh && rEl ? perSw(Math.abs(rEl.x - rSh.x)) : null;
  const leftElbowOutSw = lSh && lEl ? perSw(Math.abs(lEl.x - lSh.x)) : null;

  const rightShoulderAbductionDeg = rSh ? shoulderAbductionDeg(rSh, rWr, rEl) : null;
  const leftShoulderAbductionDeg = lSh ? shoulderAbductionDeg(lSh, lWr, lEl) : null;
  const bilateralShoulderAbductionDeg = average([rightShoulderAbductionDeg, leftShoulderAbductionDeg]);

  const rightElbowAngleDeg = rSh && rEl && rWr ? angleDeg(rSh, rEl, rWr) : null;
  const leftElbowAngleDeg = lSh && lEl && lWr ? angleDeg(lSh, lEl, lWr) : null;

  const rightWristAboveShoulder = !!(rWr && rSh && rWr.y < rSh.y);
  const leftWristAboveShoulder = !!(lWr && lSh && lWr.y < lSh.y);
  const rightWristToShoulderDy = rWr && rSh ? round3(rSh.y - rWr.y) : null;
  const leftWristToShoulderDy = lWr && lSh ? round3(lSh.y - lWr.y) : null;

  // ── Trunk ─────────────────────────────────────────────────
  // Shoulder tilt: how far the shoulder line is from level, 0..90°.
  // (It used to be the raw atan2, which reads ~180° when level.)
  const shoulderTiltDeg =
    lSh && rSh
      ? round1(toDegrees(Math.atan2(Math.abs(rSh.y - lSh.y), Math.abs(rSh.x - lSh.x))))
      : null;

  // Trunk lean: hip-centre -> shoulder-centre from vertical. Uses the
  // shoulders, not the nose, so looking up at a raised hand is not a lean.
  const hipMid = lHip && rHip ? mid(lHip, rHip) : lHip ?? rHip;
  const shoulderMid = lSh && rSh ? mid(lSh, rSh) : null;
  const trunkTop = shoulderMid ?? nose;
  // 0° when the hips are straight below the shoulders.
  const torsoLeanDeg = hipMid && trunkTop ? angleFromDownDeg(trunkTop, hipMid) : null;

  // ── Hips and knees ────────────────────────────────────────
  // Raw (frame-height) hip height, 0 top .. 1 bottom, kept to 3
  // decimals (it used to be rounded to 0.1 of the frame).
  const hipCenterY =
    lHip && rHip
      ? round3((frame.landmarks.left_hip!.y + frame.landmarks.right_hip!.y) / 2)
      : null;
  const hipHeightNormalized = hipCenterY;

  const kneeAngleLeft = lHip && lKn && lAn ? angleDeg(lHip, lKn, lAn) : null;
  const kneeAngleRight = rHip && rKn && rAn ? angleDeg(rHip, rKn, rAn) : null;

  const ratio = (hip: P | null, knee: P | null, ankle: P | null): number | null => {
    if (!hip || !knee || !ankle) return null;
    const shin = dist(knee, ankle);
    return shin < 1e-3 ? null : dist(hip, knee) / shin;
  };

  // Thigh length per torso length, from knees that are really in the picture
  // (BlazePose guesses points beyond the frame's edge).
  const inFrame = (p: P | null) => (p && p.y <= 0.97 ? p : null);
  const thighTorso = (() => {
    if (torsoLen === null || torsoLen < 1e-3) return null;
    const th = [lHip && inFrame(lKn) ? dist(lHip, lKn!) : null, rHip && inFrame(rKn) ? dist(rHip, rKn!) : null];
    const a = average(th);
    return a === null ? null : round3(a / torsoLen);
  })();
  const facingFront = shoulderWidthRatio !== null && shoulderWidthRatio > 0.5;
  const posture = inferPosture(
    [kneeAngleLeft, kneeAngleRight],
    [ratio(lHip, inFrame(lKn), inFrame(lAn)), ratio(rHip, inFrame(rKn), inFrame(rAn))],
    { facing: facingFront, thighTorso }
  );

  return {
    posture,
    rightArmElevationDeg,
    leftArmElevationDeg,
    bilateralArmElevationDeg,
    rightUpperArmDrop,
    rightUpperArmReach,
    leftUpperArmDrop,
    leftUpperArmReach,
    shoulderWidthRatio,
    rightUpperArmDropSw,
    rightUpperArmReachSw,
    leftUpperArmDropSw,
    leftUpperArmReachSw,
    rightWristDrop, leftWristDrop, rightElbowOut, leftElbowOut,
    rightWristDropSw, leftWristDropSw, rightElbowOutSw, leftElbowOutSw,
    rightArmPlaneDeg: null, leftArmPlaneDeg: null, rightElbowBent: null, leftElbowBent: null,
    rightShoulderAbductionDeg,
    leftShoulderAbductionDeg,
    bilateralShoulderAbductionDeg,
    rightElbowAngleDeg,
    leftElbowAngleDeg,
    torsoLeanDeg,
    shoulderTiltDeg,
    rightWristAboveShoulder,
    leftWristAboveShoulder,
    rightWristToShoulderDy,
    leftWristToShoulderDy,
    hipCenterY,
    hipHeightNormalized,
    kneeAngleLeft,
    kneeAngleRight,
    hipVelocityY: null,
    shoulderCenterY: shMid0 ? round3(shMid0.y) : null,
    torsoLength: torsoLen === null ? null : round3(torsoLen),
    isStanding: posture === "standing",
    isSeated: posture === "seated"
  };
}
