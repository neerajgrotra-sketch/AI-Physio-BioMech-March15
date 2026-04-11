// lib/pose/poseFrameBridge.ts
// Converts SessionRunner's PoseFrame (named landmark map) into the
// numeric landmark array format used by the ghost coordinate system.
//
// BlazePose indices used by bodyFrame.ts and poseBuilders.ts:
//   11 = LEFT_SHOULDER   12 = RIGHT_SHOULDER
//   13 = LEFT_ELBOW      14 = RIGHT_ELBOW
//   15 = LEFT_WRIST      16 = RIGHT_WRIST
//   23 = LEFT_HIP        24 = RIGHT_HIP
//   25 = LEFT_KNEE       26 = RIGHT_KNEE
//   27 = LEFT_ANKLE      28 = RIGHT_ANKLE

import type { PoseFrame } from '@/lib/types/pose';

export type NumericLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

const NAME_TO_INDEX: Record<string, number> = {
  left_shoulder:  11, right_shoulder: 12,
  left_elbow:     13, right_elbow:    14,
  left_wrist:     15, right_wrist:    16,
  left_hip:       23, right_hip:      24,
  left_knee:      25, right_knee:     26,
  left_ankle:     27, right_ankle:    28,
};

// Convert PoseFrame.landmarks (named map, normalised 0-1) to a
// 33-element array in BlazePose index order.
// Missing landmarks get visibility=0 so the ghost system skips them.
export function poseFrameToLandmarkArray(frame: PoseFrame | null): NumericLandmark[] {
  const arr: NumericLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0, y: 0, z: 0, visibility: 0,
  }));

  if (!frame || !frame.personDetected) return arr;

  for (const [name, idx] of Object.entries(NAME_TO_INDEX)) {
    const lm = (frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>)[name];
    if (!lm) continue;
    arr[idx] = {
      x: lm.x,
      y: lm.y,
      z: 0,
      visibility: lm.score ?? 1,
    };
  }

  return arr;
}

// Mirror landmark array (flip x) for mirrored video display.
export function mirrorLandmarks(lms: NumericLandmark[]): NumericLandmark[] {
  return lms.map(lm => ({ ...lm, x: 1 - lm.x }));
}
