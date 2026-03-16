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

function toRaiseScore(angleFromVertical: number | null): number | null {
  if (angleFromVertical === null) return null;

  // Arms down should be near 0–30
  // Arms raised should increase upward toward 180
  return round(180 - angleFromVertical);
}

export function extractMovementFeatures(frame: PoseFrame): MovementFeatures {
  const ls = frame.landmarks.left_shoulder;
  const rs = frame.landmarks.right_shoulder;
  const le = frame.landmarks.left_elbow;
  const re = frame.landmarks.right_elbow;
  const lw = frame.landmarks.left_wrist;
  const rw = frame.landmarks.right_wrist;

  const rightArmElevationDeg = toRaiseScore(getAbsoluteVerticalAngleDeg(rs, rw));
  const leftArmElevationDeg = toRaiseScore(getAbsoluteVerticalAngleDeg(ls, lw));

  const bilateralArmElevationDeg =
    rightArmElevationDeg !== null && leftArmElevationDeg !== null
      ? round((rightArmElevationDeg + leftArmElevationDeg) / 2)
      : null;

  const rightElbowAngleDeg = getAngleABC(rs, re, rw);
  const leftElbowAngleDeg = getAngleABC(ls, le, lw);

  const rightWristToShoulderDy = rs && rw ? round(rs.y - rw.y, 3) : null;
  const leftWristToShoulderDy = ls && lw ? round(ls.y - lw.y, 3) : null;

  return {
    posture: inferPosture(frame),

    rightArmElevationDeg,
    leftArmElevationDeg,
    bilateralArmElevationDeg,

    rightElbowAngleDeg,
    leftElbowAngleDeg,

    torsoLeanDeg: getTorsoLeanDeg(frame),
    shoulderTiltDeg: getShoulderTiltDeg(frame),

    rightWristAboveShoulder: rs && rw ? rw.y < rs.y : false,
    leftWristAboveShoulder: ls && lw ? lw.y < ls.y : false,

    rightWristToShoulderDy,
    leftWristToShoulderDy
  };
}
