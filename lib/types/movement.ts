import type { PostureType } from "@/lib/types/pose";

export type MovementFeatures = {
  posture: PostureType;

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
};

export type FeatureDebugValue =
  | string
  | number
  | boolean
  | null
  | undefined;
