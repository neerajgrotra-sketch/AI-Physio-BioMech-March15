import type {
  ExercisePosture,
  ExerciseSide,
  ExerciseTemplate
} from "@/lib/types/exercise";

export type BuilderFormValues = {
  id: string;
  name: string;
  category: "upper_body" | "lower_body" | "transfer" | "balance";
  template: ExerciseTemplate;
  side: ExerciseSide;
  posture: ExercisePosture;

  description: string;

  repTarget: number;

  startThreshold: number;
  targetThreshold: number;
  finishThreshold: number;

  targetMetric:
    | "rightArmElevationDeg"
    | "leftArmElevationDeg"
    | "bilateralArmElevationDeg";

  targetLabel: string;
  targetTolerance: number;

  holdRequired: boolean;
  holdDurationMs: number;

  tempoLabel: string;

  maxTorsoLeanDeg: number;
  maxShoulderTiltDeg: number;
  maxOppositeArmElevationDeg: number;

  cueIntro: string;
  cueLift: string;
  cueHold: string;
  cueLower: string;
  cueSuccess: string;
  cueFailedHeight: string;
  cueFailedHold: string;
  cueFailedBalance: string;
  cueFailedIsolation: string;
  cueFailedBilateralParticipation: string;
  cueLiveIsolation: string;
  cueLiveBilateral: string;
};
