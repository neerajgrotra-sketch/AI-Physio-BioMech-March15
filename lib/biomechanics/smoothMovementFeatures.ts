import type { MovementFeatures } from "@/lib/types/movement";

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;

  const total = valid.reduce((sum, value) => sum + value, 0);
  return Math.round((total / valid.length) * 10) / 10;
}

function majorityBoolean(values: boolean[]): boolean {
  if (values.length === 0) return false;
  const trueCount = values.filter(Boolean).length;
  return trueCount >= Math.ceil(values.length / 2);
}

function majorityPosture(
  values: Array<MovementFeatures["posture"]>
): MovementFeatures["posture"] {
  if (values.length === 0) return "unknown";

  const counts: Record<MovementFeatures["posture"], number> = {
    unknown: 0,
    standing: 0,
    seated: 0
  };

  for (const value of values) {
    counts[value] += 1;
  }

  if (counts.standing >= counts.seated && counts.standing >= counts.unknown) {
    return "standing";
  }

  if (counts.seated >= counts.standing && counts.seated >= counts.unknown) {
    return "seated";
  }

  return "unknown";
}

function emptyFeatures(): MovementFeatures {
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

export function smoothMovementFeatures(history: MovementFeatures[]): MovementFeatures {
  if (history.length === 0) {
    return emptyFeatures();
  }

  return {
    posture: majorityPosture(history.map((item) => item.posture)),

    rightArmElevationDeg: average(history.map((item) => item.rightArmElevationDeg)),
    leftArmElevationDeg: average(history.map((item) => item.leftArmElevationDeg)),
    bilateralArmElevationDeg: average(
      history.map((item) => item.bilateralArmElevationDeg)
    ),

    rightShoulderAbductionDeg: average(history.map((item) => item.rightShoulderAbductionDeg)),
    leftShoulderAbductionDeg: average(history.map((item) => item.leftShoulderAbductionDeg)),
    bilateralShoulderAbductionDeg: average(history.map((item) => item.bilateralShoulderAbductionDeg)),

    rightElbowAngleDeg: average(history.map((item) => item.rightElbowAngleDeg)),
    leftElbowAngleDeg: average(history.map((item) => item.leftElbowAngleDeg)),

    torsoLeanDeg: average(history.map((item) => item.torsoLeanDeg)),
    shoulderTiltDeg: average(history.map((item) => item.shoulderTiltDeg)),

    rightWristAboveShoulder: majorityBoolean(
      history.map((item) => item.rightWristAboveShoulder)
    ),
    leftWristAboveShoulder: majorityBoolean(
      history.map((item) => item.leftWristAboveShoulder)
    ),

    rightWristToShoulderDy: average(
      history.map((item) => item.rightWristToShoulderDy)
    ),
    leftWristToShoulderDy: average(
      history.map((item) => item.leftWristToShoulderDy)
    ),

    hipCenterY: average(history.map((item) => item.hipCenterY)),
    hipHeightNormalized: average(history.map((item) => item.hipHeightNormalized)),

    kneeAngleLeft: average(history.map((item) => item.kneeAngleLeft)),
    kneeAngleRight: average(history.map((item) => item.kneeAngleRight)),

    hipVelocityY: average(history.map((item) => item.hipVelocityY)),

    isStanding: majorityBoolean(history.map((item) => item.isStanding)),
    isSeated: majorityBoolean(history.map((item) => item.isSeated))
  };
}
