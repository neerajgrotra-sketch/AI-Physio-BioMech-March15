import * as poseDetection from "@tensorflow-models/pose-detection";
import "@tensorflow/tfjs-backend-webgl";

let detectorPromise: Promise<poseDetection.PoseDetector> | null = null;

export async function createPoseDetector(): Promise<poseDetection.PoseDetector> {
  if (!detectorPromise) {
    detectorPromise = poseDetection.createDetector(
      poseDetection.SupportedModels.BlazePose,
      {
        runtime: "mediapipe",
        modelType: "full",
        solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/pose"
      }
    );
  }

  return detectorPromise;
}
