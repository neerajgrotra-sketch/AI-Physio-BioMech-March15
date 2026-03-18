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
 * Returns arm elevation relative to the body:
 * - arm hanging down ≈ 0°
 * - arm at shoulder height ≈ 90°
 * - arm straight overhead ≈ 180°
 *
 * Screen coordinates:
 * - y increases downward
 */
function armElevationDeg(shoulder: PoseLandmark, wrist: PoseLandmark): number {
  const vx = wrist.x - shoulder.x;
  const vy = wrist.y - shoulder.y;

  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag < 1e-6) return 0;

  // Compare arm vector to straight-down direction (0, 1)
  const cosine = Math.max(-1, Math.min(1, vy / mag));
  const angle = Math.acos(cosine);

  return round1(toDegrees(angle));
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
    rightShoulder && rightWrist ? armElevationDeg(rightShoulder, rightWrist) : null;

  const leftArmElevationDeg =
    leftShoulder && leftWrist ? armElevationDeg(leftShoulder, leftWrist) : null;

  const bilateralArmElevationDeg = average([rightArmElevationDeg, leftArmElevationDeg]);

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
