// lib/pose/ghostConfig.ts
// ============================================================
// One GhostConfig per exercise slug — fully explicit, no inference.
//
// ARCHITECTURE:
//   GhostConfig is pure data. It tells the ghost system:
//     - which body segment(s) to animate  (drawMode)
//     - which sides to show               (sides)
//     - which landmarks to use as anchors (anchorLandmarkIndex)
//     - arm/leg segment proportions       (segmentRatios)
//     - rest direction (ghostT = 0)       (restDir)
//     - target direction (ghostT = 1)     (targetDir)
//       for ANGLE-DRIVEN exercises, targetDir is computed at
//       runtime from physioTargetDeg — set targetDir to null.
//
// ADDING A NEW EXERCISE TYPE (e.g. cervical, lumbar, ankle):
//   1. Add a new drawMode string to GhostDrawMode
//   2. Implement the draw function in ghostDrawers.ts
//   3. Add the slug entry here
//   That's it — SessionRunner and tick() need zero changes.
// ============================================================

import { LP } from './bodyFrame';

// ─── Draw modes ───────────────────────────────────────────────────────────────
// Each mode maps to a dedicated draw function in ghostDrawers.ts.
// String union so new modes are addable without touching existing code.

export type GhostDrawMode =
  | 'shoulder_arm'   // shoulder → elbow → wrist (flexion + abduction)
  | 'hip_leg'        // hip → knee → shin (knee extension)
  | 'sts_rise';      // hip midpoint upward arrow (sit to stand)

// ─── Config type ──────────────────────────────────────────────────────────────

export type GhostSide = 'left' | 'right';

export type GhostConfig = {
  /** Which draw function to call */
  drawMode: GhostDrawMode;

  /** Which sides to render — bilateral exercises list both */
  sides: GhostSide[];

  /**
   * Landmark indices for the anchor joint (e.g. shoulder or hip).
   * Keyed by side. The draw function reads these to find the pixel anchor.
   * Uses LP constants from bodyFrame.ts.
   */
  anchorLandmarkIndex: Record<GhostSide, number>;

  /**
   * Segment length ratios relative to shoulderWidth (already in canvas px).
   * upper = proximal segment (upper arm / thigh)
   * lower = distal segment  (forearm / shin)
   */
  segmentRatios: {
    upper: number;
    lower: number;
  };

  /**
   * Direction vector when ghostT = 0 (resting position).
   * Canvas Y increases downward. "Down" = { x: 0, y: 1 }.
   * Normalised inside the draw function — magnitudes don't matter.
   * Mirroring for left side is handled by the draw function (negate x).
   */
  restDir: { x: number; y: number };

  /**
   * Direction vector when ghostT = 1 (target position).
   * Set to null for exercises where target direction is computed
   * at runtime from physioTargetDeg (shoulder abduction).
   */
  targetDir: { x: number; y: number } | null;

  /**
   * For angle-driven target direction: the axis of rotation.
   * 'sagittal'  = arm sweeps forward/up in the sagittal plane (flexion)
   * 'frontal'   = arm sweeps laterally in the frontal plane (abduction)
   * 'knee'      = lower leg extends forward (knee extension)
   * null        = targetDir is fully specified in config (no angle calc)
   */
  targetPlane: 'sagittal' | 'frontal' | 'knee' | null;
};

// ─── 10 explicit exercise configs ─────────────────────────────────────────────
// Keyed by exact DB slug from exercise_templates.slug.
// Rest direction: arm hanging naturally at side — slight outward lean.
// Canvas Y increases downward so rest = { x: slight, y: 1.0 }.

export const GHOST_CONFIGS: Record<string, GhostConfig> = {

  // ── Shoulder Flexion ────────────────────────────────────────────────────────
  // Arm sweeps forward and UP in the sagittal plane.
  // Target: arm vertical overhead → { x: 0, y: -1 } (negative Y = up in canvas).
  // ghostT=0: arm hangs down. ghostT=1: arm vertical overhead.

  shoulder_flexion_right: {
    drawMode:   'shoulder_arm',
    sides:      ['right'],
    anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
    segmentRatios: { upper: 1.05, lower: 0.90 },
    restDir:    { x: 0.12, y: 1.0 },
    targetDir:  { x: 0.06, y: -1.0 },
    targetPlane: null,
  },

  shoulder_flexion_left: {
    drawMode:   'shoulder_arm',
    sides:      ['left'],
    anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
    segmentRatios: { upper: 1.05, lower: 0.90 },
    restDir:    { x: 0.12, y: 1.0 },
    targetDir:  { x: 0.06, y: -1.0 },
    targetPlane: null,
  },

  shoulder_flexion_bilateral: {
    drawMode:   'shoulder_arm',
    sides:      ['left', 'right'],
    anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
    segmentRatios: { upper: 1.05, lower: 0.90 },
    restDir:    { x: 0.12, y: 1.0 },
    targetDir:  { x: 0.06, y: -1.0 },
    targetPlane: null,
  },

  // ── Shoulder Abduction ──────────────────────────────────────────────────────
  // Arm sweeps laterally OUT in the frontal plane.
  // targetDir = null → computed at runtime from physioTargetDeg.
  // targetPlane: 'frontal' tells ghostAnimator how to compute the direction.

  shoulder_abduction_right: {
    drawMode:   'shoulder_arm',
    sides:      ['right'],
    anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
    segmentRatios: { upper: 1.05, lower: 0.90 },
    restDir:    { x: 0.12, y: 1.0 },
    targetDir:  null,             // computed from physioTargetDeg
    targetPlane: 'frontal',
  },

  shoulder_abduction_left: {
    drawMode:   'shoulder_arm',
    sides:      ['left'],
    anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
    segmentRatios: { upper: 1.05, lower: 0.90 },
    restDir:    { x: 0.12, y: 1.0 },
    targetDir:  null,
    targetPlane: 'frontal',
  },

  shoulder_abduction_bilateral: {
    drawMode:   'shoulder_arm',
    sides:      ['left', 'right'],
    anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
    segmentRatios: { upper: 1.05, lower: 0.90 },
    restDir:    { x: 0.12, y: 1.0 },
    targetDir:  null,
    targetPlane: 'frontal',
  },

  // ── Knee Extension ──────────────────────────────────────────────────────────
  // Seated: lower leg extends forward from the knee.
  // Anchor = hip (thigh drawn hip→knee on detected positions,
  // shin drawn knee→extended from ghostT).

  knee_extension_right: {
    drawMode:   'hip_leg',
    sides:      ['right'],
    anchorLandmarkIndex: { right: LP.RIGHT_HIP, left: LP.LEFT_HIP },
    segmentRatios: { upper: 1.0, lower: 1.0 }, // actual length computed from landmarks
    restDir:    { x: 0.10, y: 1.0 },   // shin hangs down
    targetDir:  { x: 0.85, y: 0.10 },  // shin extends forward
    targetPlane: null,
  },

  knee_extension_left: {
    drawMode:   'hip_leg',
    sides:      ['left'],
    anchorLandmarkIndex: { right: LP.RIGHT_HIP, left: LP.LEFT_HIP },
    segmentRatios: { upper: 1.0, lower: 1.0 },
    restDir:    { x: 0.10, y: 1.0 },
    targetDir:  { x: 0.85, y: 0.10 },
    targetPlane: null,
  },

  knee_extension_bilateral: {
    drawMode:   'hip_leg',
    sides:      ['left', 'right'],
    anchorLandmarkIndex: { right: LP.RIGHT_HIP, left: LP.LEFT_HIP },
    segmentRatios: { upper: 1.0, lower: 1.0 },
    restDir:    { x: 0.10, y: 1.0 },
    targetDir:  { x: 0.85, y: 0.10 },
    targetPlane: null,
  },

  // ── Sit to Stand ────────────────────────────────────────────────────────────
  // Uses hip midpoint — draws an upward arrow showing rise direction.
  // sides unused (drawMode handles both hips internally).
  // segmentRatios.upper = fraction of torsoLen for arrow height.

  sit_to_stand: {
    drawMode:   'sts_rise',
    sides:      ['left', 'right'], // both hips needed for midpoint
    anchorLandmarkIndex: { right: LP.RIGHT_HIP, left: LP.LEFT_HIP },
    segmentRatios: { upper: 0.80, lower: 0 },
    restDir:    { x: 0, y: 0 },   // not used for sts_rise
    targetDir:  { x: 0, y: -1 },  // upward
    targetPlane: null,
  },
};

// ─── Runtime target direction for angle-driven exercises ──────────────────────
// Called by ghostAnimator when config.targetDir is null.
// physioTargetDeg: the prescribed angle in degrees (0 = at side, 90 = horizontal, 180 = overhead)
// Returns normalised direction vector for the RIGHT side.
// Draw function negates x for the left side.

export function computeAbductionTargetDir(physioTargetDeg: number): { x: number; y: number } {
  // physioTargetDeg is measured from the side of the body (0° = arm at side).
  // Canvas Y increases downward.
  // At 0°:   arm hangs down → { x: 1, y: 0 } from shoulder outward, but in our
  //          coordinate system the arm points { x: 0.12, y: 1 } (restDir).
  // At 90°:  arm horizontal → { x: 1, y: 0 }
  // At 180°: arm straight up → { x: 0, y: -1 }
  //
  // Map physioTargetDeg (0→180) to canvas direction:
  //   x component = sin(angle)     (lateral)
  //   y component = -cos(angle)    (upward is negative in canvas Y)
  const rad = (physioTargetDeg * Math.PI) / 180;
  return {
    x: Math.sin(rad),
    y: -Math.cos(rad),
  };
}

// ─── Config lookup with fallback ──────────────────────────────────────────────

const FALLBACK_CONFIG: GhostConfig = {
  drawMode:   'shoulder_arm',
  sides:      ['right'],
  anchorLandmarkIndex: { right: LP.RIGHT_SHOULDER, left: LP.LEFT_SHOULDER },
  segmentRatios: { upper: 1.05, lower: 0.90 },
  restDir:    { x: 0.12, y: 1.0 },
  targetDir:  { x: 0.06, y: -1.0 },
  targetPlane: null,
};

export function getGhostConfig(slug: string): GhostConfig {
  return GHOST_CONFIGS[slug] ?? FALLBACK_CONFIG;
}
