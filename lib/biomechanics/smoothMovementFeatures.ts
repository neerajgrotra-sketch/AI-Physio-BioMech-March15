import type { MovementFeatures } from "@/lib/types/movement";
import type { PostureType } from "@/lib/types/pose";

function averageNullable(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;

  const sum = valid.reduce((acc, value) => acc + value, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

function majorityBoolean(values: boolean[]): boolean {
  const trueCount = values.filter(Boolean).length;
  return trueCount >= Math.ceil(values.length / 2);
}

function majorityPosture(values: PostureType[]): PostureType {
  const counts: Record<PostureType, number> = {
    seated: 0,
    standing: 0,
    unknown: 0
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

export function smoothMovementFeatures(history: MovementFeatures[]): MovementFeatures {
  if (history.length === 0) {
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
      leftWristToShoulderDy: null
    };
  }

  return {
    posture: majorityPosture(history.map((item) => item.posture)),

    rightArmElevationDeg: averageNullable(history.map((item) => item.rightArmElevationDeg)),
    leftArmElevationDeg: averageNullable(history.map((item) => item.leftArmElevationDeg)),
    bilateralArmElevationDeg: averageNullable(
      history.map((item) => item.bilateralArmElevationDeg)
    ),

    rightElbowAngleDeg: averageNullable(history.map((item) => item.rightElbowAngleDeg)),
    leftElbowAngleDeg: averageNullable(history.map((item) => item.leftElbowAngleDeg)),

    torsoLeanDeg: averageNullable(history.map((item) => item.torsoLeanDeg)),
    shoulderTiltDeg: averageNullable(history.map((item) => item.shoulderTiltDeg)),

    rightWristAboveShoulder: majorityBoolean(
      history.map((item) => item.rightWristAboveShoulder)
    ),
    leftWristAboveShoulder: majorityBoolean(
      history.map((item) => item.leftWristAboveShoulder)
    ),

    rightWristToShoulderDy: averageNullable(
      history.map((item) => item.rightWristToShoulderDy)
    ),
    leftWristToShoulderDy: averageNullable(
      history.map((item) => item.leftWristToShoulderDy)
    )
  };
}
