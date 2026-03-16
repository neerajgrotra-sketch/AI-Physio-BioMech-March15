import type { Pose } from "@tensorflow-models/pose-detection";
import type { LandmarkName, PoseFrame, PoseLandmarksMap } from "@/lib/types/pose";

const LANDMARK_INDEX_MAP: Partial<Record<LandmarkName, number>> = {
  nose: 0,
  left_eye: 2,
  right_eye: 5,
  left_ear: 7,
  right_ear: 8,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28
};

const LANDMARK_NAMES = Object.keys(LANDMARK_INDEX_MAP) as LandmarkName[];

export function normalizePoseFrame(
  pose: Pose | null,
  sourceWidth: number,
  sourceHeight: number
): PoseFrame {
  if (!pose || !pose.keypoints || pose.keypoints.length === 0) {
    return {
      timestamp: Date.now(),
      landmarks: {},
      personDetected: false,
      sourceWidth,
      sourceHeight
    };
  }

  const landmarks: PoseLandmarksMap = {};

  for (const name of LANDMARK_NAMES) {
    const idx = LANDMARK_INDEX_MAP[name];
    if (idx === undefined) continue;

    const keypoint = pose.keypoints[idx];
    if (!keypoint) continue;

    landmarks[name] = {
      x: sourceWidth > 0 ? keypoint.x / sourceWidth : keypoint.x,
      y: sourceHeight > 0 ? keypoint.y / sourceHeight : keypoint.y,
      score: keypoint.score
    };
  }

  return {
    timestamp: Date.now(),
    landmarks,
    personDetected: true,
    sourceWidth,
    sourceHeight
  };
}
