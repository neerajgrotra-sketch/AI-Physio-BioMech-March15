// ============================================================
// lib/pose/reachGuide.ts
// ============================================================
// The front-view guide for a forward arm raise. Facing the camera the
// ghost can't show a forward raise (it would sweep the arm sideways, a
// different exercise), so instead a "Reach here" line marks the height the
// hand must reach for the target angle, and turns green when it is reached.
//
// Height of the hand at elevation θ (straight elbow): shoulder.y + arm·cos θ
// (image y grows downward), with the arm's length from the learned upper-
// arm length (lib/biomechanics/flexionView.ts, in torso lengths) and a
// forearm about 0.9 of it. Pure: reachLineY is tested; drawReachGuide only
// draws.
// ============================================================

import type { PoseFrame } from "@/lib/types/pose";

const FOREARM_SHARE = 0.9;

/**
 * Where the hand should reach, as a fraction of the frame height (0 top,
 * 1 bottom), or null if the shoulder, hips or arm length are not known.
 */
export function reachLineY(
  frame: PoseFrame,
  side: "right" | "left",
  upperArmTorsos: number | null,
  targetDeg: number
): number | null {
  if (!upperArmTorsos) return null;
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const A = frame.sourceWidth && frame.sourceHeight ? frame.sourceWidth / frame.sourceHeight : 16 / 9;
  const seen = (k: string) => (lm[k] && (lm[k]!.score ?? 1) >= 0.35 ? { x: lm[k]!.x * A, y: lm[k]!.y } : null);
  const sh = seen(`${side}_shoulder`);
  const torso = torsoLength(frame);
  if (!sh || torso === null) return null;
  const arm = upperArmTorsos * torso * (1 + FOREARM_SHARE);
  return sh.y + arm * Math.cos((targetDeg * Math.PI) / 180);
}

// Shoulder width is about 0.8 of the torso length facing the camera.
const SW_PER_TORSO = 0.8;

/** Torso length (shoulder centre to hip centre) in frame heights; from the shoulders if the hips are hidden. */
export function torsoLength(frame: PoseFrame): number | null {
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const A = frame.sourceWidth && frame.sourceHeight ? frame.sourceWidth / frame.sourceHeight : 16 / 9;
  const seen = (k: string) => (lm[k] && (lm[k]!.score ?? 1) >= 0.35 ? { x: lm[k]!.x * A, y: lm[k]!.y } : null);
  const lS = seen("left_shoulder"), rS = seen("right_shoulder"), lH = seen("left_hip"), rH = seen("right_hip");
  if (!lS || !rS) return null;
  if (lH && rH) return Math.hypot((lS.x + rS.x) / 2 - (lH.x + rH.x) / 2, (lS.y + rS.y) / 2 - (lH.y + rH.y) / 2);
  return Math.abs(lS.x - rS.x) / SW_PER_TORSO;
}

/**
 * The ghost arm seen from the front: the arm raised forward to `deg`
 * (0 down, 90 pointing at the camera, 180 overhead). Its elbow and hand
 * sit at their heights for that angle (shoulder.y + length·cos θ), and the
 * hand grows as it comes toward the camera, so the arm reads as reaching
 * out toward you rather than sweeping sideways.
 */
export function drawFrontGhost(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  side: "right" | "left",
  upperArmTorsos: number,
  deg: number,
  opacity: number,
  rgb: { r: number; g: number; b: number },
  W: number,
  H: number
): void {
  const lm = frame.landmarks as Record<string, { x: number; y: number } | undefined>;
  const sh = lm[`${side}_shoulder`];
  const torso = torsoLength(frame);
  if (!sh || torso === null) return;
  const th = (deg * Math.PI) / 180;
  const up = upperArmTorsos * torso;          // frame heights
  const fore = up * FOREARM_SHARE;
  const sx = (1 - sh.x) * W, sy = sh.y * H;   // mirrored, like the preview
  // A slight outward lean so the arm stays visible even when pointing at the lens.
  // In the mirrored preview the patient's right arm is on the screen's right.
  const out = side === "right" ? 1 : -1;
  const lean = 0.06 * torso * H * Math.sin(th) * out;
  const ex = sx + lean * 0.6, ey = sy + up * Math.cos(th) * H;
  const wx = sx + lean, wy = sy + (up + fore) * Math.cos(th) * H;
  const near = 1 + 0.9 * Math.sin(th);        // nearer the camera: bigger
  const thick = torso * H * 0.16;
  const col = (a: number) => `rgba(${rgb.r},${rgb.g},${rgb.b},${a * opacity})`;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Soft halo, then the limb.
  ctx.strokeStyle = col(0.25);
  ctx.lineWidth = thick * 1.9 * near;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  ctx.strokeStyle = col(0.8);
  ctx.lineWidth = thick * near;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  // The hand.
  ctx.fillStyle = col(0.9);
  ctx.beginPath(); ctx.arc(wx, wy, thick * 0.75 * near, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.6 * opacity})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Draws the guide on the ghost canvas (W x H, mirrored like the preview). */
export function drawReachGuide(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  side: "right" | "left",
  lineY: number,
  reached: boolean,
  targetDeg: number,
  W: number,
  H: number,
  nowMs: number
): void {
  const lm = frame.landmarks as Record<string, { x: number; y: number } | undefined>;
  const sh = lm[`${side}_shoulder`];
  if (!sh) return;
  const cx = (1 - sh.x) * W; // the preview is mirrored
  const y = Math.max(8, Math.min(H - 8, lineY * H));
  const half = W * 0.14;
  const pulse = reached ? 1 : 0.65 + 0.35 * Math.sin(nowMs / 260);
  const col = reached ? "63,185,80" : "255,190,60";

  ctx.save();
  ctx.lineCap = "round";
  // Soft glow, then the bar.
  ctx.strokeStyle = `rgba(${col},${0.25 * pulse})`;
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
  ctx.strokeStyle = `rgba(${col},${0.95})`;
  ctx.lineWidth = 4;
  ctx.setLineDash(reached ? [] : [14, 9]);
  ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
  ctx.setLineDash([]);
  // Label above the bar.
  const label = reached ? "✓ Target reached" : `Reach here  ↑  ${Math.round(targetDeg)}°`;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const ly = y - 14;
  ctx.fillStyle = "rgba(10,14,30,0.72)";
  ctx.beginPath();
  (ctx as any).roundRect?.(cx - tw / 2 - 12, ly - 25, tw + 24, 34, 9) ?? ctx.rect(cx - tw / 2 - 12, ly - 25, tw + 24, 34);
  ctx.fill();
  ctx.fillStyle = `rgba(${col},1)`;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, ly);
  ctx.restore();
}
