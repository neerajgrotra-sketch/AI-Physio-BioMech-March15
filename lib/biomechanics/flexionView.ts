// ============================================================
// lib/biomechanics/flexionView.ts
// ============================================================
// Arm elevation (shoulder flexion) that works whether the patient faces
// the camera or stands side on.
//
// SIDE ON the arm swings across the image, so the plain angle of the
// upper arm from straight down (extractMovementFeatures) is right.
//
// FACING THE CAMERA a forward raise moves the arm toward the lens, which
// a 2D camera cannot see: the arm only looks shorter. But the arm's
// HEIGHT is still visible. If L is the upper arm's true length, the
// elbow is L·cos(θ) below the shoulder at elevation θ, whatever the
// arm's direction (forward, sideways or between). So
//
//     θ = acos(drop / L)
//
// where drop is how far the elbow is below the shoulder (negative when
// above). L is learned from the patient while the arm hangs at rest,
// where it looks its full length: a high percentile of the upper arm's
// seen length in those frames. Both are measured in torso lengths, so stepping nearer or
// further from the camera changes nothing.
//
// Accuracy: best in the middle of the range (60°-130°), where the elbow's
// height changes fastest. Near 0° and 180° the height barely changes, so
// readings there are coarser (about ±10° near 160°).
//
// Pure apart from its own memory; one instance per exercise, reset
// between exercises. Used by useInferenceLoop and lib/testing/replay.ts,
// right after smoothing. Tested by flexionView.test.ts.
// ============================================================

import type { MovementFeatures } from "@/lib/types/movement";

export type FacingView = "front" | "side";

// Shoulder width / torso length: ~0.7-0.9 facing the camera, ~0.1-0.3 side on.
export const SIDE_BELOW = 0.35;
export const FRONT_ABOVE = 0.5;

const WINDOW = 600;       // seen-length samples kept (about 20 s at 30 fps)
const MIN_SAMPLES = 10;   // before this, the arm length is not known yet
const PERCENTILE = 0.8;
const HANGING = 0.9;      // drop / seen length above this = arm hanging down

class ArmLength {
  private seen: number[] = [];
  private length: number | null = null;

  /**
   * Learns from a frame only while the arm hangs roughly straight down
   * (the elbow's drop is most of its seen length), where the arm is
   * square to the camera. A raised arm is nearer the lens and can look
   * longer than it is (perspective, or a tracking glitch), which would
   * make the resting arm read too high.
   */
  observe(reach: number | null, drop: number | null): void {
    if (reach === null || drop === null || !(reach > 0)) return;
    if (drop < HANGING * reach) return;
    this.seen.push(reach);
    if (this.seen.length > WINDOW) this.seen.shift();
    if (this.seen.length < MIN_SAMPLES) return;
    const sorted = [...this.seen].sort((a, b) => a - b);
    const p = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * PERCENTILE))];
    // Only grows: an arm cannot get shorter, it only looks shorter.
    this.length = this.length === null ? p : Math.max(this.length, p);
  }

  get(): number | null {
    return this.length;
  }
}

/** Elevation from straight down, from the elbow's drop and the arm's length. */
export function elevationFromDrop(drop: number, length: number): number {
  const c = Math.max(-1, Math.min(1, drop / length));
  return Math.round(((Math.acos(c) * 180) / Math.PI) * 10) / 10;
}

export class FlexionViewEstimator {
  private right = new ArmLength();
  private left = new ArmLength();
  private view: FacingView | null = null;

  reset(): void {
    this.right = new ArmLength();
    this.left = new ArmLength();
    this.view = null;
  }

  /** The learned upper-arm length (torso lengths), or null until known. */
  armLength(side: "right" | "left"): number | null {
    return (side === "right" ? this.right : this.left).get();
  }

  /** The view the last frame was judged to be in. */
  currentView(): FacingView | null {
    return this.view;
  }

  /**
   * Updates which way the patient faces (with hysteresis, so a slight
   * turn does not flip it) and, unless side on, replaces the arm
   * elevation fields on `f` with the drop-based estimate. In place.
   */
  apply(f: MovementFeatures): void {
    this.right.observe(f.rightUpperArmReach, f.rightUpperArmDrop);
    this.left.observe(f.leftUpperArmReach, f.leftUpperArmDrop);

    const w = f.shoulderWidthRatio;
    if (w === null) {
      // One shoulder hidden: the other is behind the body, so side on.
      if (f.rightUpperArmReach !== null || f.leftUpperArmReach !== null) this.view = "side";
    } else if (this.view === null) {
      this.view = w < (SIDE_BELOW + FRONT_ABOVE) / 2 ? "side" : "front";
    } else if (this.view === "front" && w < SIDE_BELOW) {
      this.view = "side";
    } else if (this.view === "side" && w > FRONT_ABOVE) {
      this.view = "front";
    }

    if (this.view !== "front") return; // side on: the plain angle is right

    const est = (drop: number | null, arm: ArmLength): number | null => {
      const L = arm.get();
      return drop === null || L === null ? null : elevationFromDrop(drop, L);
    };
    f.rightArmElevationDeg = est(f.rightUpperArmDrop, this.right);
    f.leftArmElevationDeg = est(f.leftUpperArmDrop, this.left);
    const both = [f.rightArmElevationDeg, f.leftArmElevationDeg].filter((v): v is number => v !== null);
    f.bilateralArmElevationDeg = both.length
      ? Math.round((both.reduce((a, b) => a + b, 0) / both.length) * 10) / 10
      : null;
  }
}
