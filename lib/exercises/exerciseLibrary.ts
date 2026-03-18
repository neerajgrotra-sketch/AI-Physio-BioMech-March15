import type { ExercisePrescription } from "@/lib/types/exercise";

export const RIGHT_ARM_RAISE: ExercisePrescription = {
  id: "right-arm-raise",
  name: "Right Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "right",
  posture: "either",
  description: "Lift your right arm to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "rightArmElevationDeg",
    label: "shoulder height",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "slow and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 18,
    maxShoulderTiltDeg: 15,
    maxOppositeArmElevationDeg: 35
  },

  coaching: {
    intro: "Begin when ready.",
    lift: "Lift your right arm to shoulder height.",
    hold: "Hold at the top.",
    lower: "Lower with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Lift your right arm a little higher and try again.",
    failedHold:
      "That rep did not count. Hold a little longer at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay upright and balanced.",
    failedIsolation:
      "That rep did not count. Keep your left arm relaxed at your side and raise only your right arm.",
    liveIsolationCue: "Keep your left arm relaxed at your side."
  }
};

export const LEFT_ARM_RAISE: ExercisePrescription = {
  id: "left-arm-raise",
  name: "Left Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "left",
  posture: "either",
  description: "Lift your left arm to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "leftArmElevationDeg",
    label: "shoulder height",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "slow and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 18,
    maxShoulderTiltDeg: 15,
    maxOppositeArmElevationDeg: 35
  },

  coaching: {
    intro: "Begin when ready.",
    lift: "Lift your left arm to shoulder height.",
    hold: "Hold at the top.",
    lower: "Lower with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Lift your left arm a little higher and try again.",
    failedHold:
      "That rep did not count. Hold a little longer at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay upright and balanced.",
    failedIsolation:
      "That rep did not count. Keep your right arm relaxed at your side and raise only your left arm.",
    liveIsolationCue: "Keep your right arm relaxed at your side."
  }
};

export const BOTH_ARM_RAISE: ExercisePrescription = {
  id: "both-arm-raise",
  name: "Both Arm Raise",
  category: "upper_body",
  template: "raise_hold_lower",
  runtimeStatus: "active",
  side: "both",
  posture: "either",
  description: "Lift both arms to shoulder height, hold, then lower slowly.",

  repTarget: 6,

  startThreshold: 25,
  targetThreshold: 70,
  finishThreshold: 30,

  target: {
    metric: "bilateralArmElevationDeg",
    label: "shoulder height",
    targetValue: 70,
    tolerance: 10
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "slow and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 18,
    maxShoulderTiltDeg: 15
  },

  coaching: {
    intro: "Begin when ready.",
    lift: "Lift both arms to shoulder height.",
    hold: "Hold at the top.",
    lower: "Lower with control.",
    success: "Good repetition.",
    failedHeight:
      "That rep did not count. Lift both arms a little higher and try again.",
    failedHold:
      "That rep did not count. Hold a little longer at the top and try again.",
    failedBalance:
      "That rep did not count. Try to stay upright and balanced.",
    failedBilateralParticipation:
      "That rep did not count. Lift both arms to shoulder height together.",
    liveBilateralCue: "Lift both arms together."
  }
};

export const SIT_TO_STAND: ExercisePrescription = {
  id: "sit-to-stand",
  name: "Sit to Stand",
  category: "transfer",
  template: "rise_hold_lower",
  runtimeStatus: "active",
  side: "center",
  posture: "either",
  description: "Stand up from a seated position, hold briefly, then sit back down slowly.",

  repTarget: 5,

  startThreshold: 110,
  targetThreshold: 155,
  finishThreshold: 120,

  target: {
    metric: "hipHeightNormalized",
    label: "full standing position",
    targetValue: 155,
    tolerance: 8
  },

  hold: {
    required: true,
    durationMs: 2000
  },

  tempo: {
    label: "steady and controlled"
  },

  qualityLimits: {
    maxTorsoLeanDeg: 25
  },

  coaching: {
    intro: "Begin seated and stand up when ready.",
    lift: "Stand up fully.",
    hold: "Hold your standing position.",
    lower: "Sit down slowly.",
    success: "Good stand.",
    failedHeight:
      "That rep did not count. Stand up a little taller and try again.",
    failedHold:
      "That rep did not count. Hold your standing position a little longer and try again.",
    failedBalance:
      "That rep did not count. Try to stay balanced and controlled."
  }
};

export const EXERCISE_LIBRARY: ExercisePrescription[] = [
  RIGHT_ARM_RAISE,
  LEFT_ARM_RAISE,
  BOTH_ARM_RAISE,
  SIT_TO_STAND
];

export const ACTIVE_EXERCISE_LIBRARY: ExercisePrescription[] =
  EXERCISE_LIBRARY.filter((exercise) => exercise.runtimeStatus === "active");
