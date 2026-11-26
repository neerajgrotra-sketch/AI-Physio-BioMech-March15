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
 * Draws the target marker on the ghost canvas (W x H, mirrored like the
 * preview): a short bar at the hand's target height, on the OUTER side of
 * the raised arm with its label pointing away from the body, so it never
 * crosses the patient's face (it used to be centred on the shoulder).
 */
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
  const out = side === "right" ? 1 : -1;     // mirrored: the right arm is on the screen's right
  const cx = (1 - sh.x) * W;
  const y = Math.max(14, Math.min(H - 8, lineY * H));
  const x1 = Math.max(6, Math.min(W - 6, cx + out * W * 0.05));
  const x2 = Math.max(6, Math.min(W - 6, cx + out * W * 0.2));
  const pulse = reached ? 1 : 0.65 + 0.35 * Math.sin(nowMs / 260);
  const col = reached ? "63,185,80" : "255,190,60";

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${col},${0.25 * pulse})`;
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.strokeStyle = `rgba(${col},0.95)`;
  ctx.lineWidth = 4;
  ctx.setLineDash(reached ? [] : [10, 7]);
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.setLineDash([]);
  // Label just above the bar, anchored at its outer end.
  const label = reached ? "✓ Target" : `Reach ${Math.round(targetDeg)}°`;
  ctx.font = "700 16px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const lx = out > 0 ? Math.min(x2 - tw, W - tw - 8) : Math.max(x2, 8);
  ctx.fillStyle = "rgba(10,14,30,0.72)";
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(lx - 7, y - 30, tw + 14, 24, 7) : ctx.rect(lx - 7, y - 30, tw + 14, 24);
  ctx.fill();
  ctx.fillStyle = `rgba(${col},1)`;
  ctx.textAlign = "left";
  ctx.fillText(label, lx, y - 12);
  ctx.restore();
}
