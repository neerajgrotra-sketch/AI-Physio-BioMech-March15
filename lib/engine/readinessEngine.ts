import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { ExercisePrescription } from "@/lib/types/exercise";

export type ReadinessIssue =
  | "too_dark"
  | "person_not_visible"
  | "upper_body_not_visible"
  | "hands_not_visible"
  | "too_close"
  | "too_far"
  | "not_centered"
  | "not_stable"
  | "needs_raise_test"
  | "ready";

export type ReadinessState = {
  ready: boolean;
  issue: ReadinessIssue;
  message: string;
  confidence: number;
  checks: {
    personDetected: boolean;
    centered: boolean;
    upperBodyVisible: boolean;
    handsVisible: boolean;
    stable: boolean;
    brightnessOk: boolean;
    scaleOk: boolean;
    raiseTestPassed: boolean;
  };
};

type ReadinessContext = {
  frame: PoseFrame | null;
  features: MovementFeatures;
  prescription: ExercisePrescription;
  previousState?: ReadinessState | null;
  hasCompletedRaiseTest?: boolean;
  averageBrightness?: number | null;
};

type OverlayKeypoint = {
  name: string;
  x: number;
  y: number;
  score?: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getFrameKeypoints(frame: PoseFrame | null): OverlayKeypoint[] {
  if (!frame || typeof frame !== "object") return [];

  const maybeKeypoints = (frame as any).keypoints;
  if (!Array.isArray(maybeKeypoints)) return [];

  return maybeKeypoints.filter((kp: any) => {
    return (
      kp &&
      typeof kp.name === "string" &&
      typeof kp.x === "number" &&
      typeof kp.y === "number"
    );
  }) as OverlayKeypoint[];
}

function getKeypoint(frame: PoseFrame | null, name: string): OverlayKeypoint | null {
  const keypoints = getFrameKeypoints(frame);
  return keypoints.find((kp) => kp.name === name) ?? null;
}

function isVisible(
  frame: PoseFrame | null,
  name: string,
  minScore = 0.35
): boolean {
  const kp = getKeypoint(frame, name);
  if (!kp) return false;
  return (kp.score ?? 1) >= minScore;
}

function isUpperBodyVisible(frame: PoseFrame | null): boolean {
  const required = [
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow"
  ];

  return required.every((name) => isVisible(frame, name, 0.35));
}

function areHandsVisibleForExercise(
  frame: PoseFrame | null,
  prescription: ExercisePrescription
): boolean {
  const leftHandVisible = isVisible(frame, "left_wrist", 0.3);
  const rightHandVisible = isVisible(frame, "right_wrist", 0.3);

  switch (prescription.id) {
    case "right-arm-raise":
      return rightHandVisible;
    case "left-arm-raise":
      return leftHandVisible;
    case "both-arm-raise":
      return leftHandVisible && rightHandVisible;
    default:
      return leftHandVisible || rightHandVisible;
  }
}

function isCentered(frame: PoseFrame | null): boolean {
  const nose = getKeypoint(frame, "nose");
  const leftShoulder = getKeypoint(frame, "left_shoulder");
  const rightShoulder = getKeypoint(frame, "right_shoulder");

  if (!nose || !leftShoulder || !rightShoulder) return false;

  const centerX =
    typeof nose.x === "number"
      ? nose.x
      : (leftShoulder.x + rightShoulder.x) / 2;

  return centerX >= 0.28 && centerX <= 0.72;
}

function hasReasonableScale(frame: PoseFrame | null): {
  ok: boolean;
  tooClose: boolean;
  tooFar: boolean;
} {
  const leftShoulder = getKeypoint(frame, "left_shoulder");
  const rightShoulder = getKeypoint(frame, "right_shoulder");
  const nose = getKeypoint(frame, "nose");

  if (!leftShoulder || !rightShoulder || !nose) {
    return { ok: false, tooClose: false, tooFar: false };
  }

  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  const headY = nose.y;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const torsoHeight = Math.abs(shoulderY - headY);

  const tooFar = shoulderWidth < 0.12 || torsoHeight < 0.08;
  const tooClose = shoulderWidth > 0.5 || torsoHeight > 0.28;

  return {
    ok: !tooFar && !tooClose,
    tooClose,
    tooFar
  };
}

function isStable(frame: PoseFrame | null): boolean {
  const leftShoulder = getKeypoint(frame, "left_shoulder");
  const rightShoulder = getKeypoint(frame, "right_shoulder");

  if (!leftShoulder || !rightShoulder) return false;

  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);
  return shoulderTilt < 0.12;
}

function isBrightnessOk(averageBrightness?: number | null): boolean {
  if (averageBrightness === null || averageBrightness === undefined) {
    return true;
  }

  return averageBrightness >= 40;
}

function needsRaiseTest(
  prescription: ExercisePrescription,
  hasCompletedRaiseTest?: boolean
): boolean {
  if (hasCompletedRaiseTest) return false;

  return (
    prescription.id === "right-arm-raise" ||
    prescription.id === "left-arm-raise" ||
    prescription.id === "both-arm-raise"
  );
}

function getIssueMessage(issue: ReadinessIssue): string {
  switch (issue) {
    case "too_dark":
      return "Turn on a light so I can see you clearly.";

    case "person_not_visible":
      return "Step into view so I can see you properly.";

    case "upper_body_not_visible":
      return "Make sure your head, shoulders, and upper body are visible.";

    case "hands_not_visible":
      return "Make sure your hands stay visible in the camera frame.";

    case "too_close":
      return "Step back a little so your full upper body fits in frame.";

    case "too_far":
      return "Move a little closer so I can track your movement clearly.";

    case "not_centered":
      return "Center yourself in the frame and face the camera.";

    case "not_stable":
      return "Stand still for a moment so I can check your position.";

    case "needs_raise_test":
      return "Please lift both arms once so I can check your framing.";

    case "ready":
      return "Good. Stay there. You are positioned well.";

    default:
      return "Adjust your position so I can see you clearly.";
  }
}

export function evaluateReadiness({
  frame,
  features,
  prescription,
  hasCompletedRaiseTest = false,
  averageBrightness = null
}: ReadinessContext): ReadinessState {
  const personDetected = Boolean((frame as any)?.personDetected);
  const upperBodyVisible = isUpperBodyVisible(frame);
  const handsVisible = areHandsVisibleForExercise(frame, prescription);
  const centered = isCentered(frame);
  const stable = isStable(frame);
  const brightnessOk = isBrightnessOk(averageBrightness);
  const scale = hasReasonableScale(frame);
  const raiseTestPassed = !needsRaiseTest(prescription, hasCompletedRaiseTest);

  let issue: ReadinessIssue = "ready";

  if (!brightnessOk) {
    issue = "too_dark";
  } else if (!personDetected) {
    issue = "person_not_visible";
  } else if (!upperBodyVisible) {
    issue = "upper_body_not_visible";
  } else if (!handsVisible) {
    issue = "hands_not_visible";
  } else if (scale.tooClose) {
    issue = "too_close";
  } else if (scale.tooFar) {
    issue = "too_far";
  } else if (!centered) {
    issue = "not_centered";
  } else if (!stable) {
    issue = "not_stable";
  } else if (!raiseTestPassed) {
    issue = "needs_raise_test";
  }

  const checks = {
    personDetected,
    centered,
    upperBodyVisible,
    handsVisible,
    stable,
    brightnessOk,
    scaleOk: scale.ok,
    raiseTestPassed
  };

  const passingChecks = Object.values(checks).filter(Boolean).length;
  const confidence = clamp(passingChecks / Object.keys(checks).length, 0, 1);

  return {
    ready: issue === "ready",
    issue,
    message: getIssueMessage(issue),
    confidence,
    checks
  };
}