import { round } from "@/lib/biomechanics/jointAngles";
import type { PoseFrame, PostureType } from "@/lib/types/pose";

export function inferPosture(frame: PoseFrame): PostureType {
  const leftHip = frame.landmarks.left_hip;
  const rightHip = frame.landmarks.right_hip;
  const leftKnee = frame.landmarks.left_knee;
  const rightKnee = frame.landmarks.right_knee;
  const leftShoulder = frame.landmarks.left_shoulder;
  const rightShoulder = frame.landmarks.right_shoulder;

  if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) {
    return "unknown";
  }

  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;

  const torsoHeight = Math.abs(hipMidY - shoulderMidY);

  if (leftKnee && rightKnee) {
    const kneeMidY = (leftKnee.y + rightKnee.y) / 2;
    const hipToKnee = Math.abs(kneeMidY - hipMidY);

    if (hipToKnee < torsoHeight * 0.75) {
      return "seated";
    }

    return "standing";
  }

  return "unknown";
}

export function getTorsoLeanDeg(frame: PoseFrame): number | null {
  const leftShoulder = frame.landmarks.left_shoulder;
  const rightShoulder = frame.landmarks.right_shoulder;
  const leftHip = frame.landmarks.left_hip;
  const rightHip = frame.landmarks.right_hip;

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;

  const dx = shoulderMidX - hipMidX;
  const dy = shoulderMidY - hipMidY;

  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return null;

  const verticalUpX = 0;
  const verticalUpY = -1;

  const vx = dx / length;
  const vy = dy / length;

  const dot = vx * verticalUpX + vy * verticalUpY;
  const cosine = Math.max(-1, Math.min(1, dot));

  return round((Math.acos(cosine) * 180) / Math.PI);
}

export function getShoulderTiltDeg(frame: PoseFrame): number | null {
  const leftShoulder = frame.landmarks.left_shoulder;
  const rightShoulder = frame.landmarks.right_shoulder;

  if (!leftShoulder || !rightShoulder) return null;

  const dy = rightShoulder.y - leftShoulder.y;
  const dx = rightShoulder.x - leftShoulder.x;

  if (dx === 0 && dy === 0) return null;

  return round((Math.atan2(dy, dx) * 180) / Math.PI);
}
