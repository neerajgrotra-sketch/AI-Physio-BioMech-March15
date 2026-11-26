export type MovementFeatures = {
  posture: "unknown" | "standing" | "seated";

  rightArmElevationDeg: number | null;
  leftArmElevationDeg: number | null;
  bilateralArmElevationDeg: number | null;

  // Raw upper-arm geometry for front-view flexion (lib/biomechanics/
  // flexionView.ts), in units of the torso length (shoulder centre to hip
  // centre), which does not change when the patient turns:
  //   *UpperArmDrop  = how far the elbow is BELOW the shoulder (negative above)
  //   *UpperArmReach = the upper arm's length as seen in the image
  //   shoulderWidthRatio = shoulder width / torso: ~0.7-0.9 facing the
  //   camera, under ~0.35 side on.
  rightUpperArmDrop: number | null;
  rightUpperArmReach: number | null;
  leftUpperArmDrop: number | null;
  leftUpperArmReach: number | null;
  shoulderWidthRatio: number | null;
  // The same drop and seen length per shoulder width: the fallback scale
  // when the hips are hidden (behind a desk), facing the camera.
  rightUpperArmDropSw: number | null;
  rightUpperArmReachSw: number | null;
  leftUpperArmDropSw: number | null;
  leftUpperArmReachSw: number | null;
  // For the form checks facing the camera (flexionView.ts): how far the
  // wrist is below the shoulder, and how far the elbow is out to the side
  // of the shoulder (always >= 0), per torso length and per shoulder width.
  rightWristDrop: number | null;
  leftWristDrop: number | null;
  rightElbowOut: number | null;
  leftElbowOut: number | null;
  rightWristDropSw: number | null;
  leftWristDropSw: number | null;
  rightElbowOutSw: number | null;
  leftElbowOutSw: number | null;
  // Set by flexionView.ts facing the camera, else null:
  //   *ArmPlaneDeg  0 = arm straight in front, 90 = straight out to the side
  //   *ElbowBent    the hand is well above where a straight arm would put it
  rightArmPlaneDeg: number | null;
  leftArmPlaneDeg: number | null;
  rightElbowBent: boolean | null;
  leftElbowBent: boolean | null;

  // Shoulder abduction metrics — separate from flexion elevation.
  // The whole arm from straight down, measured from a front camera.
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
