import {
  getAbsoluteVerticalAngleDeg,
  getAngleABC,
  round
} from "@/lib/biomechanics/jointAngles";
import {
  getShoulderTiltDeg,
  getTorsoLeanDeg,
  inferPosture
} from "@/lib/biomechanics/posture";
import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";

export function extractMovementFeatures(frame: PoseFrame): MovementFeatures {
  const ls = frame.landmarks.left_shoulder;
  const rs = frame.landmarks.right_shoulder;
  const le = frame.landmarks.left_elbow;
  const re = frame.landmarks.right_elbow;
  const lw = frame.landmarks.left_wrist;
  const rw = frame.landmarks.right_wrist;

  const rightArmElevationDeg = getAbsoluteVerticalAngleDeg(rs, rw);
  const leftArmElevationDeg = getAbsoluteVerticalAngleDeg(ls, lw);

  const bilateralArmElevationDeg =
    rightArmElevationDeg !== null && leftArmElevationDeg !== null
      ? round((rightArmElevationDeg + leftArmElevationDeg) / 2)
      : null;

  const rightElbowAngleDeg = getAngleABC(rs, re, rw);
  const leftElbowAngleDeg = getAngleABC(ls, le, lw);

  const rightWristToShoulderDy =
    rs && rw ? round(rs.y - rw.y, 3) : null;

  const leftWristToShoulderDy =
    ls && lw ? round(ls.y - lw.y, 3) : null;

  return {
    posture: inferPosture(frame),

    rightArmElevationDeg,
    leftArmElevationDeg,
    bilateralArmElevationDeg,

    rightElbowAngleDeg,
    leftElbowAngleDeg,

    torsoLeanDeg: getTorsoLeanDeg(frame),
    shoulderTiltDeg: getShoulderTiltDeg(frame),

    rightWristAboveShoulder:
      rs && rw ? rw.y < rs.y : false,

    leftWristAboveShoulder:
      ls && lw ? lw.y < ls.y : false,

    rightWristToShoulderDy,
    leftWristToShoulderDy
  };
}
