export type ExerciseSide = "left" | "right" | "both" | "center";
export type ExercisePosture = "seated" | "standing" | "either";

export type MovementPhase =
  | "idle"
  | "ready"
  | "lifting"
  | "top"
  | "holding"
  | "lowering"
  | "bottom"
  | "complete";

export type MetricSource =
  | "rightArmElevationDeg"
  | "leftArmElevationDeg"
  | "bilateralArmElevationDeg"
  | "rightElbowAngleDeg"
  | "leftElbowAngleDeg"
  | "torsoLeanDeg"
  | "shoulderTiltDeg"
  | "rightWristAboveShoulder"
  | "leftWristAboveShoulder"
  | "rightWristToShoulderDy"
  | "leftWristToShoulderDy"
  | "hipCenterY"
  | "hipCenterVelocityY"
  | "kneeToHipExtensionScore";

export type ExerciseTarget = {
  metric: MetricSource;
  label: string;
  targetValue: number;
  tolerance?: number;
};

export type HoldRequirement = {
  required: boolean;
  durationMs: number;
};

export type TempoRequirement = {
  liftMinMs?: number;
  lowerMinMs?: number;
  label?: string;
};

export type QualityLimits = {
  maxTorsoLeanDeg?: number;
  maxShoulderTiltDeg?: number;

  // For unilateral exercises
  maxOppositeArmElevationDeg?: number;
};

export type CoachingCues = {
  intro: string;
  lift: string;
  hold: string;
  lower: string;
  success: string;
  failedHeight: string;
  failedHold: string;
  failedBalance: string;
  failedIsolation?: string;
  failedBilateralParticipation?: string;

  liveIsolationCue?: string;
  liveBilateralCue?: string;
};

export type ExercisePrescription = {
  id: string;
  name: string;
  category: "upper_body" | "lower_body" | "transfer" | "balance";
  side: ExerciseSide;
  posture: ExercisePosture;
  description: string;

  repTarget: number;

  startThreshold: number;
  targetThreshold: number;
  finishThreshold: number;

  target: ExerciseTarget;
  hold: HoldRequirement;
  tempo?: TempoRequirement;
  qualityLimits?: QualityLimits;
  coaching: CoachingCues;
};
