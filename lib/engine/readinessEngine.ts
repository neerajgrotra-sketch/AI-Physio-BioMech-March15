import type { MovementFeatures } from "@/lib/types/movement";
import type { PoseFrame } from "@/lib/types/pose";
import type { ExercisePrescription } from "@/lib/types/exercise";

export type ReadinessIssue =
  | "camera_off"
  | "too_dark"
  | "person_not_visible"
  | "upper_body_not_visible"
  | "hands_not_visible"
  | "too_close"
  | "too_far"
  | "not_centered"
  | "not_stable"
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
  };
};

type ReadinessContext = {
  frame: PoseFrame | null;
  features: MovementFeatures;
  prescription: ExercisePrescription;
  previousState?: ReadinessState | null;
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

function getKeypoint(frame: PoseFrame | null, name: string): OverlayKeypoint | null {
  const landmarks = (frame as any)?.landmarks;
  const kp = landmarks?.[name];
  if (!kp || typeof kp.x !== "number" || typeof kp.y !== "number") return null;

  return {
    name,
    x: kp.x,
    y: kp.y,
    score: kp.score ?? 1
  };
}

function isVisible(frame: PoseFrame | null, name: string, minScore = 0.2): boolean {
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

  const visibleCount = required.filter((name) => isVisible(frame, name, 0.2)).length;
  return visibleCount >= 4;
}

function areHandsVisibleForExercise(
  frame: PoseFrame | null,
  prescription: ExercisePrescription
): boolean {
  const leftHandVisible = isVisible(frame, "left_wrist", 0.15);
  const rightHandVisible = isVisible(frame, "right_wrist", 0.15);

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

  return centerX >= 0.18 && centerX <= 0.82;
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

  const tooFar = shoulderWidth < 0.08 || torsoHeight < 0.05;
  const tooClose = shoulderWidth > 0.65 || torsoHeight > 0.38;

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
  return shoulderTilt < 0.18;
}

function isBrightnessOk(averageBrightness?: number | null): boolean {
  if (averageBrightness === null || averageBrightness === undefined) {
    return true;
  }

  return averageBrightness >= 40;
}

function getIssueMessage(issue: ReadinessIssue): string {
  switch (issue) {
    case "camera_off":
      return "Camera is off.";

    case "too_dark":
      return "Turn on a light so I can see you clearly.";

    case "person_not_visible":
      return "Step into view so I can see you properly.";

    case "upper_body_not_visible":
      return "I need to see your head and shoulders clearly.";

    case "hands_not_visible":
      return "I can see your upper body. Bring your hands into the frame.";

    case "too_close":
      return "Step back a little so your upper body fits in frame.";

    case "too_far":
      return "Move a little closer so I can track your movement clearly.";

    case "not_centered":
      return "Center yourself in the frame and face the camera.";

    case "not_stable":
      return "Hold still for a moment while I check your position.";

    case "ready":
      return "You're well positioned.";

    default:
      return "Adjust your position so I can see you clearly.";
  }
}

export function evaluateReadiness({
  frame,
  features,
  prescription,
  averageBrightness = null
}: ReadinessContext): ReadinessState {
  const personDetected = Boolean((frame as any)?.personDetected);

  if (!frame || !personDetected) {
    return {
      ready: false,
      issue: "person_not_visible",
      message: getIssueMessage("person_not_visible"),
      confidence: 0,
      checks: {
        personDetected: false,
        centered: false,
        upperBodyVisible: false,
        handsVisible: false,
        stable: false,
        brightnessOk: true,
        scaleOk: false
      }
    };
  }

  const upperBodyVisible = isUpperBodyVisible(frame);
  const handsVisible = areHandsVisibleForExercise(frame, prescription);
  const centered = isCentered(frame);
  const stable = isStable(frame);
  const brightnessOk = isBrightnessOk(averageBrightness);
  const scale = hasReasonableScale(frame);

  let issue: ReadinessIssue = "ready";

  if (!brightnessOk) {
    issue = "too_dark";
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
  }

  const checks = {
    personDetected,
    centered,
    upperBodyVisible,
    handsVisible,
    stable,
    brightnessOk,
    scaleOk: scale.ok
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
