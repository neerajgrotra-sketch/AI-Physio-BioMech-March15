export type MovementFeatures = {
  posture: "unknown" | "standing" | "seated";

  rightArmElevationDeg: number | null;
  leftArmElevationDeg: number | null;
  bilateralArmElevationDeg: number | null;

  // Shoulder abduction metrics — separate from flexion elevation.
  // Computed from wrist position relative to shoulder, normalised by
  // shoulder width. Reliable from a front-facing camera for lateral
  // arm raises where armElevationDeg underestimates due to 2D projection.
  // 0° = arm at rest (hanging down), ~90° = arm level with shoulder,
  // ~150° = arm fully overhead.
  rightShoulderAbductionDeg: number | null;
  leftShoulderAbductionDeg: number | null;
  bilateralShoulderAbductionDeg: number | null;

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
