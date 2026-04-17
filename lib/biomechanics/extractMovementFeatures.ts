import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame, PoseLandmark, PostureType } from "@/lib/types/pose";

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function angleDeg(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number | null {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magCB = Math.sqrt(cbx * cbx + cby * cby);

  if (magAB < 1e-6 || magCB < 1e-6) return null;

  const dot = abx * cbx + aby * cby;
  const cosine = Math.max(-1, Math.min(1, dot / (magAB * magCB)));

  return round1(toDegrees(Math.acos(cosine)));
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return round1(valid.reduce((sum, v) => sum + v, 0) / valid.length);
}

/**
 * Returns arm elevation relative to the body using the UPPER ARM (shoulder→elbow).
 * This matches clinical goniometric measurement of shoulder flexion/abduction ROM:
 * - Physio places goniometer at shoulder joint
 * - Moving arm aligned with humerus (upper arm), NOT the forearm or wrist
 *
 * - arm hanging down ≈ 0°
 * - arm at shoulder height ≈ 90°
 * - arm straight overhead ≈ 180°
 *
 * Screen coordinates: y increases downward.
 *
 * Uses elbow as the distal landmark (upper arm vector).
 * Falls back to wrist if elbow is not visible (null).
 */
function armElevationDeg(
  shoulder: PoseLandmark,
  elbow: PoseLandmark | null,
  wrist: PoseLandmark | null
): number | null {
  // Prefer elbow (clinical upper-arm measurement), fall back to wrist
  const distal = elbow ?? wrist;
  if (!distal) return null;

  const vx = distal.x - shoulder.x;
  const vy = distal.y - shoulder.y;

  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag < 1e-6) return 0;

  // Compare upper-arm vector to straight-down direction (0, 1)
  const cosine = Math.max(-1, Math.min(1, vy / mag));
  const angle = Math.acos(cosine);

  return round1(toDegrees(angle));
}

/**
 * Measures shoulder abduction angle from a front-facing camera.
 *
 * armElevationDeg() fails for abduction because it measures the 2D projection
 * of the upper arm vector from vertical — for a lateral sweep (coronal plane)
 * the arm moves mostly in Z (depth) and the 2D projection caps at ~100°.
 *
 * This function uses the wrist position relative to the shoulder, normalised
 * by shoulder width, to compute a robust abduction angle that works from a
 * front camera:
 *
 * - Lateral displacement (dx): how far wrist has moved away from shoulder
 *   horizontally. This is the primary abduction signal — fully visible from front.
 * - Vertical rise (dy): how far wrist has risen above shoulder.
 *   At 90° abduction wrist is ~level with shoulder; overhead it rises above.
 *
 * The angle is computed as atan2(dy_norm, dx_norm) offset from the resting
 * position (~270° below and out), remapped to 0° (rest) → 90° (shoulder level)
 * → 150° (overhead).
 *
 * Normalisation by shoulder width makes it invariant to camera distance.
 */
function shoulderAbductionDeg(
  shoulder: PoseLandmark,
  wrist: PoseLandmark | null,
  otherShoulder: PoseLandmark | null,
  side: "right" | "left"
): number | null {
  if (!wrist) return null;

  // Shoulder width for normalisation — fall back to fixed fraction if unavailable
  const shoulderWidth = otherShoulder
    ? Math.sqrt(
        Math.pow(shoulder.x - otherShoulder.x, 2) +
        Math.pow(shoulder.y - otherShoulder.y, 2)
      )
    : 0.2; // ~20% of frame width as fallback

  if (shoulderWidth < 1e-6) return null;

  // Lateral displacement: positive = wrist moving away from body centerline
  // For right arm: wrist moves right (x increases in screen coords, but mirrored
  // so right arm moves toward lower x). Use abs() — we care about magnitude not direction.
  const dx = Math.abs(wrist.x - shoulder.x) / shoulderWidth;

  // Vertical rise: positive = wrist above shoulder
  // Screen y increases downward, so above shoulder = wrist.y < shoulder.y
  const dy = (shoulder.y - wrist.y) / shoulderWidth;

  // Angle from horizontal: atan2(vertical_rise, lateral_spread)
  // At rest: dx small (~0.3), dy very negative (~-2.5) → angle ≈ -83° (pointing down)
  // At 90° abduction: dx large (~1.4), dy near zero → angle ≈ 0°
  // Overhead: dx still large, dy positive → angle > 0°
  const angleFromHorizontal = toDegrees(Math.atan2(dy, dx));

  // Remap to clinical abduction degrees:
  // angleFromHorizontal of -90° (arm straight down) → 0° abduction
  // angleFromHorizontal of 0° (arm level with shoulder) → 90° abduction
  // angleFromHorizontal of +60° (arm overhead) → 150° abduction
  // Formula: abductionDeg = angleFromHorizontal + 90
  const abductionDeg = angleFromHorizontal + 90;

  // Clamp to valid range
  return round1(Math.max(0, Math.min(180, abductionDeg)));
}

function inferPosture(
  leftHip: PoseLandmark | null,
  rightHip: PoseLandmark | null,
  leftKnee: PoseLandmark | null,
  rightKnee: PoseLandmark | null,
  kneeAngleLeft: number | null,
  kneeAngleRight: number | null
): PostureType {
  if (!leftHip || !rightHip || !leftKnee || !rightKnee) {
    return "unknown";
  }

  const avgKneeAngle = average([kneeAngleLeft, kneeAngleRight]);

  if (avgKneeAngle === null) {
    return "unknown";
  }

  if (avgKneeAngle > 155) {
    return "standing";
  }

  if (avgKneeAngle < 120) {
    return "seated";
  }

  return "unknown";
}

function getLandmark(
  frame: PoseFrame,
  key:
    | "nose"
    | "left_shoulder"
    | "right_shoulder"
    | "left_elbow"
    | "right_elbow"
    | "left_wrist"
    | "right_wrist"
    | "left_hip"
    | "right_hip"
    | "left_knee"
    | "right_knee"
    | "left_ankle"
    | "right_ankle"
): PoseLandmark | null {
  return frame.landmarks[key] ?? null;
}

export function extractMovementFeatures(frame: PoseFrame): MovementFeatures {
  if (!frame.personDetected) {
    return {
      posture: "unknown",
      rightArmElevationDeg: null,
      leftArmElevationDeg: null,
      bilateralArmElevationDeg: null,
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
      isStanding: false,
      isSeated: false
    };
  }

  const nose = getLandmark(frame, "nose");

  const leftShoulder = getLandmark(frame, "left_shoulder");
  const rightShoulder = getLandmark(frame, "right_shoulder");

  const leftElbow = getLandmark(frame, "left_elbow");
  const rightElbow = getLandmark(frame, "right_elbow");

  const leftWrist = getLandmark(frame, "left_wrist");
  const rightWrist = getLandmark(frame, "right_wrist");

  const leftHip = getLandmark(frame, "left_hip");
  const rightHip = getLandmark(frame, "right_hip");

  const leftKnee = getLandmark(frame, "left_knee");
  const rightKnee = getLandmark(frame, "right_knee");

  const leftAnkle = getLandmark(frame, "left_ankle");
  const rightAnkle = getLandmark(frame, "right_ankle");

  const rightArmElevationDeg =
    rightShoulder ? armElevationDeg(rightShoulder, rightElbow, rightWrist) : null;

  const leftArmElevationDeg =
    leftShoulder ? armElevationDeg(leftShoulder, leftElbow, leftWrist) : null;

  const bilateralArmElevationDeg = average([rightArmElevationDeg, leftArmElevationDeg]);

  // Shoulder abduction — computed separately from flexion elevation
  const rightShoulderAbductionDeg = rightShoulder
    ? shoulderAbductionDeg(rightShoulder, rightWrist, leftShoulder, "right")
    : null;

  const leftShoulderAbductionDeg = leftShoulder
    ? shoulderAbductionDeg(leftShoulder, leftWrist, rightShoulder, "left")
    : null;

  const bilateralShoulderAbductionDeg = average([
    rightShoulderAbductionDeg,
    leftShoulderAbductionDeg,
  ]);

  const rightElbowAngleDeg =
    rightShoulder && rightElbow && rightWrist
      ? angleDeg(rightShoulder, rightElbow, rightWrist)
      : null;

  const leftElbowAngleDeg =
    leftShoulder && leftElbow && leftWrist
      ? angleDeg(leftShoulder, leftElbow, leftWrist)
      : null;

  const rightWristAboveShoulder =
    !!(rightWrist && rightShoulder && rightWrist.y < rightShoulder.y);

  const leftWristAboveShoulder =
    !!(leftWrist && leftShoulder && leftWrist.y < leftShoulder.y);

  const rightWristToShoulderDy =
    rightWrist && rightShoulder ? round1(rightShoulder.y - rightWrist.y) : null;

  const leftWristToShoulderDy =
    leftWrist && leftShoulder ? round1(leftShoulder.y - leftWrist.y) : null;

  const shoulderTiltDeg =
    leftShoulder && rightShoulder
      ? round1(
          Math.abs(
            toDegrees(
              Math.atan2(
                rightShoulder.y - leftShoulder.y,
                rightShoulder.x - leftShoulder.x
              )
            )
          )
        )
      : null;

  const torsoLeanDeg =
    nose && leftHip && rightHip
      ? (() => {
          const hipCenterX = (leftHip.x + rightHip.x) / 2;
          const hipCenterY = (leftHip.y + rightHip.y) / 2;

          const dx = nose.x - hipCenterX;
          const dy = hipCenterY - nose.y;

          const mag = Math.sqrt(dx * dx + dy * dy);
          if (mag < 1e-6) return null;

          // Lean away from vertical
          const cosine = Math.max(-1, Math.min(1, dy / mag));
          const angle = Math.acos(cosine);

          return round1(toDegrees(angle));
        })()
      : null;

  const hipCenterY =
    leftHip && rightHip ? round1((leftHip.y + rightHip.y) / 2) : null;

  const hipHeightNormalized = hipCenterY;

  const kneeAngleLeft =
    leftHip && leftKnee && leftAnkle ? angleDeg(leftHip, leftKnee, leftAnkle) : null;

  const kneeAngleRight =
    rightHip && rightKnee && rightAnkle ? angleDeg(rightHip, rightKnee, rightAnkle) : null;

  const posture = inferPosture(
    leftHip,
    rightHip,
    leftKnee,
    rightKnee,
    kneeAngleLeft,
    kneeAngleRight
  );

  const isStanding = posture === "standing";
  const isSeated = posture === "seated";

  return {
    posture,
    rightArmElevationDeg,
    leftArmElevationDeg,
    bilateralArmElevationDeg,
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
    isStanding,
    isSeated
  };
}
