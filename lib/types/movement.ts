export type MovementFeatures = {
  posture: "unknown" | "standing" | "seated";

  rightArmElevationDeg: number | null;
  leftArmElevationDeg: number | null;
  bilateralArmElevationDeg: number | null;

  rightElbowAngleDeg: number | null;
  leftElbowAngleDeg: number | null;

  torsoLeanDeg: number | null;
  shoulderTiltDeg: number | null;

  rightWristAboveShoulder: boolean;
  leftWristAboveShoulder: boolean;

  rightWristToShoulderDy: number | null;
  leftWristToShoulderDy: number | null;

  // LOWER BODY

  hipCenterY: number | null;
  hipHeightNormalized: number | null;

  kneeAngleLeft: number | null;
  kneeAngleRight: number | null;

  hipVelocityY: number | null;

  isStanding: boolean;
  isSeated: boolean;
};
