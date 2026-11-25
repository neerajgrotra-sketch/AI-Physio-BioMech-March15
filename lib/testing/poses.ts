// ============================================================
// lib/testing/poses.ts — synthetic poses for the tests
// ============================================================
// Builds PoseFrames the way normalizePoseFrame does (x / width,
// y / height), from a body described in PIXELS. Lets tests say
// "right arm at 45° in a 1280x720 frame" and check the angle that
// comes out, with no camera.
// ============================================================

import type { LandmarkName, PoseFrame, PoseLandmark } from "@/lib/types/pose";

export type Px = { x: number; y: number };
export type PixelBody = Partial<Record<LandmarkName, Px>>;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Point at `len` px from `from`, at `deg` from straight down, toward +x (image right). */
export function fromDown(from: Px, deg: number, len: number, towardRight = true): Px {
  const sx = towardRight ? 1 : -1;
  return { x: from.x + sx * Math.sin(rad(deg)) * len, y: from.y + Math.cos(rad(deg)) * len };
}

export function frameFromPixels(
  body: PixelBody,
  width = 1280,
  height = 720,
  opts: { timestamp?: number; score?: number; scores?: Partial<Record<LandmarkName, number>> } = {}
): PoseFrame {
  const landmarks: Partial<Record<LandmarkName, PoseLandmark>> = {};
  for (const [name, p] of Object.entries(body) as Array<[LandmarkName, Px]>) {
    landmarks[name] = {
      x: p.x / width,
      y: p.y / height,
      score: opts.scores?.[name] ?? opts.score ?? 0.95,
    };
  }
  return {
    timestamp: opts.timestamp ?? 0,
    landmarks,
    personDetected: true,
    sourceWidth: width,
    sourceHeight: height,
  };
}

/**
 * A person facing the camera, standing, arms down. The patient's
 * right side is on the image LEFT (camera not mirrored), as BlazePose
 * reports it. Sizes in px for a 1280x720 frame.
 */
export function standingFront(opts: { rightArmDeg?: number; leftArmDeg?: number; cx?: number } = {}): PixelBody {
  const cx = opts.cx ?? 640;
  const rSh = { x: cx - 70, y: 230 };
  const lSh = { x: cx + 70, y: 230 };
  const arm = 140; // shoulder -> elbow
  const fore = 120; // elbow -> wrist
  // Right arm swings out to image-left, left arm to image-right.
  const rEl = fromDown(rSh, opts.rightArmDeg ?? 5, arm, false);
  const rWr = fromDown(rEl, opts.rightArmDeg ?? 5, fore, false);
  const lEl = fromDown(lSh, opts.leftArmDeg ?? 5, arm, true);
  const lWr = fromDown(lEl, opts.leftArmDeg ?? 5, fore, true);
  return {
    nose: { x: cx, y: 150 },
    right_shoulder: rSh, left_shoulder: lSh,
    right_elbow: rEl, left_elbow: lEl,
    right_wrist: rWr, left_wrist: lWr,
    right_hip: { x: cx - 45, y: 430 }, left_hip: { x: cx + 45, y: 430 },
    right_knee: { x: cx - 47, y: 560 }, left_knee: { x: cx + 47, y: 560 },
    right_ankle: { x: cx - 48, y: 690 }, left_ankle: { x: cx + 48, y: 690 },
  };
}

/** Seated, facing the camera: thighs point at the lens, so they look short. */
export function seatedFront(cx = 640): PixelBody {
  return {
    nose: { x: cx, y: 200 },
    right_shoulder: { x: cx - 70, y: 280 }, left_shoulder: { x: cx + 70, y: 280 },
    right_elbow: { x: cx - 75, y: 400 }, left_elbow: { x: cx + 75, y: 400 },
    right_wrist: { x: cx - 70, y: 500 }, left_wrist: { x: cx + 70, y: 500 },
    right_hip: { x: cx - 50, y: 480 }, left_hip: { x: cx + 50, y: 480 },
    right_knee: { x: cx - 55, y: 530 }, left_knee: { x: cx + 55, y: 530 },   // 50 px: foreshortened thigh
    right_ankle: { x: cx - 55, y: 660 }, left_ankle: { x: cx + 55, y: 660 }, // 130 px shin
  };
}

/**
 * Seen from the patient's RIGHT side, seated, facing image-right.
 * `kneeDeg` is the interior right-knee angle (90 bent, 180 straight).
 * Both legs share the pose unless `leftKneeDeg` is given.
 */
export function seatedSide(kneeDeg = 90, leftKneeDeg?: number): PixelBody {
  const hip = { x: 560, y: 450 };
  const knee = { x: 700, y: 450 }; // thigh horizontal, 140 px
  const shin = 140;
  // Shin angle from straight down: 90 interior -> 0 (down), 180 -> 90 (forward).
  const ankleAt = (k: number) => fromDown(knee, k - 90, shin, true);
  return {
    nose: { x: 580, y: 170 },
    right_shoulder: { x: 560, y: 250 }, left_shoulder: { x: 565, y: 252 },
    right_elbow: { x: 565, y: 360 }, left_elbow: { x: 568, y: 362 },
    right_wrist: { x: 600, y: 440 }, left_wrist: { x: 603, y: 442 },
    right_hip: hip, left_hip: { x: hip.x + 4, y: hip.y + 2 },
    right_knee: knee, left_knee: { x: knee.x + 4, y: knee.y + 2 },
    right_ankle: ankleAt(kneeDeg), left_ankle: (() => { const a = ankleAt(leftKneeDeg ?? kneeDeg); return { x: a.x + 4, y: a.y + 2 }; })(),
  };
}

/** Standing, seen from the side. */
export function standingSide(): PixelBody {
  return {
    nose: { x: 650, y: 110 },
    right_shoulder: { x: 630, y: 190 }, left_shoulder: { x: 634, y: 192 },
    right_elbow: { x: 632, y: 300 }, left_elbow: { x: 636, y: 302 },
    right_wrist: { x: 640, y: 400 }, left_wrist: { x: 644, y: 402 },
    right_hip: { x: 630, y: 400 }, left_hip: { x: 634, y: 402 },
    right_knee: { x: 636, y: 540 }, left_knee: { x: 640, y: 542 },
    right_ankle: { x: 630, y: 680 }, left_ankle: { x: 634, y: 682 },
  };
}

/**
 * Standing, seen from the side of the raised arm, that arm raised
 * forward `deg` from down. `side: "both"` raises both arms together.
 */
export function flexionSide(deg: number, side: "right" | "left" | "both" = "right"): PixelBody {
  const b = standingSide();
  const raise = (sh: Px) => {
    const el = fromDown(sh, deg, 140, true);
    return { sh, el, wr: fromDown(el, deg, 120, true) };
  };
  if (side === "right" || side === "both") {
    const r = raise({ x: 630, y: 230 });
    Object.assign(b, { right_shoulder: r.sh, right_elbow: r.el, right_wrist: r.wr });
  }
  if (side === "left" || side === "both") {
    const l = raise({ x: 634, y: 232 });
    Object.assign(b, { left_shoulder: l.sh, left_elbow: l.el, left_wrist: l.wr });
  }
  return b;
}

/**
 * Scales a body about its own centre and moves that centre to (cx, cy) px.
 * Lets a test put the same pose near, far, or off to one side.
 */
export function place(body: PixelBody, scale: number, cx: number, cy: number): PixelBody {
  const pts = Object.values(body) as Px[];
  const mx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const my = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  const out: PixelBody = {};
  for (const [k, p] of Object.entries(body) as Array<[LandmarkName, Px]>) {
    out[k] = { x: cx + (p.x - mx) * scale, y: cy + (p.y - my) * scale };
  }
  return out;
}
