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
// above). L starts at a typical arm length (TYPICAL_ARM) and is then
// learned from the patient: facing the camera an arm only looks shorter
// than it is, so L is a high percentile of its seen length while it is in
// its lower half. If the hips are hidden, shoulder width is the scale. Both are measured in torso lengths, so stepping nearer or
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

const WINDOW = 900;       // seen-length samples kept (about 30 s at 30 fps)
const MIN_SAMPLES = 30;   // before this, the typical arm length is used
const PERCENTILE = 0.95;
const LOWER_HALF = 0.5;   // learn only while drop / seen length is above this
// A typical upper arm is about 0.6 torso lengths (shoulder centre to hip
// centre). Used until the patient's own is learned, so the angle is never
// blank at the start (it used to be null until learned, and with a hand
// resting on a desk it was never learned: no angle for the first minute).
export const TYPICAL_ARM = 0.6;
// A learned length is not trusted below this share of the typical one (an
// arm that never hangs straight down only ever looks shortened).
const MIN_SHARE_OF_TYPICAL = 0.9;

class ArmLength {
  private seen: number[] = [];
  private learned: number | null = null;

  /**
   * Learns from frames where the arm is in its lower half. Facing the
   * camera a forward arm only looks shorter than it is, so the longest it
   * is seen (a high percentile, to skip glitches) is its length: reached
   * whenever it hangs straight down.
   */
  observe(reach: number | null, drop: number | null): void {
    if (reach === null || drop === null || !(reach > 0)) return;
    if (drop < LOWER_HALF * reach) return;
    this.seen.push(reach);
    if (this.seen.length > WINDOW) this.seen.shift();
    if (this.seen.length < MIN_SAMPLES) return;
    const sorted = [...this.seen].sort((a, b) => a - b);
    const p = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * PERCENTILE))];
    this.learned = this.learned === null ? p : Math.max(this.learned, p);
  }

  /** The arm length to use: the learned one, else the typical one. */
  get(): number {
    return this.learned === null ? TYPICAL_ARM : Math.max(this.learned, MIN_SHARE_OF_TYPICAL * TYPICAL_ARM);
  }

  isLearned(): boolean {
    return this.learned !== null;
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
  // Shoulder width / torso length while both are seen, to convert the
  // per-shoulder-width readings when the hips are hidden.
  private swPerTorso: number | null = null;

  reset(): void {
    this.right = new ArmLength();
    this.left = new ArmLength();
    this.view = null;
    this.swPerTorso = null;
  }

  /** The upper-arm length in use (torso lengths): learned, else typical. */
  armLength(side: "right" | "left"): number {
    return (side === "right" ? this.right : this.left).get();
  }

  /** Whether the patient's own arm length has been learned yet. */
  armLearned(side: "right" | "left"): boolean {
    return (side === "right" ? this.right : this.left).isLearned();
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
    const w = f.shoulderWidthRatio;
    // Hips hidden (behind a desk): convert the per-shoulder-width readings
    // to torso lengths with the ratio seen while both were visible.
    if (w !== null && this.view !== "side") {
      this.swPerTorso = this.swPerTorso === null ? w : this.swPerTorso + (w - this.swPerTorso) * 0.05;
    }
    const k = this.swPerTorso;
    const pick = (t: number | null, sw: number | null) => (t !== null ? t : sw !== null && k !== null ? Math.round(sw * k * 1000) / 1000 : null);
    const rDrop = pick(f.rightUpperArmDrop, f.rightUpperArmDropSw);
    const rReach = pick(f.rightUpperArmReach, f.rightUpperArmReachSw);
    const lDrop = pick(f.leftUpperArmDrop, f.leftUpperArmDropSw);
    const lReach = pick(f.leftUpperArmReach, f.leftUpperArmReachSw);

    if (w === null) {
      const bothShoulders = f.rightUpperArmDropSw !== null || f.leftUpperArmDropSw !== null;
      if (bothShoulders) {
        // Both shoulders seen but no hips: keep the view, or assume facing.
        this.view ??= "front";
      } else if (f.rightUpperArmReach !== null || f.leftUpperArmReach !== null) {
        // One shoulder hidden: the other is behind the body, so side on.
        this.view = "side";
      }
    } else if (this.view === null) {
      this.view = w < (SIDE_BELOW + FRONT_ABOVE) / 2 ? "side" : "front";
    } else if (this.view === "front" && w < SIDE_BELOW) {
      this.view = "side";
    } else if (this.view === "side" && w > FRONT_ABOVE) {
      this.view = "front";
    }

    if (this.view !== "front") return; // side on: the plain angle is right

    this.right.observe(rReach, rDrop);
    this.left.observe(lReach, lDrop);
    const est = (drop: number | null, arm: ArmLength): number | null =>
      drop === null ? null : elevationFromDrop(drop, arm.get());
    f.rightArmElevationDeg = est(rDrop, this.right);
    f.leftArmElevationDeg = est(lDrop, this.left);
    const both = [f.rightArmElevationDeg, f.leftArmElevationDeg].filter((v): v is number => v !== null);
    f.bilateralArmElevationDeg = both.length
      ? Math.round((both.reduce((a, b) => a + b, 0) / both.length) * 10) / 10
      : null;
  }
}
