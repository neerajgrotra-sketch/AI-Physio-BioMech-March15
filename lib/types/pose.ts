export type LandmarkName =
  | "nose"
  | "left_eye"
  | "right_eye"
  | "left_ear"
  | "right_ear"
  | "left_shoulder"
  | "right_shoulder"
  | "left_elbow"
  | "right_elbow"
  | "left_wrist"
  | "right_wrist"
  | "left_hip"
  | "right_hip"
  | "left_knee"
  | "right_knee"
  | "left_ankle"
  | "right_ankle";

export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  score?: number;
};

export type PoseLandmarksMap = Partial<Record<LandmarkName, PoseLandmark>>;

export type PoseFrame = {
  timestamp: number;
  landmarks: PoseLandmarksMap;
  personDetected: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type PostureType = "seated" | "standing" | "unknown";
export type BodySide = "left" | "right" | "bilateral" | "unknown";
