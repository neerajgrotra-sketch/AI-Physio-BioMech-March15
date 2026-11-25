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
  const lS = seen("left_shoulder"), rS = seen("right_shoulder"), lH = seen("left_hip"), rH = seen("right_hip");
  if (!sh || !lS || !rS || !lH || !rH) return null;
  const torso = Math.hypot((lS.x + rS.x) / 2 - (lH.x + rH.x) / 2, (lS.y + rS.y) / 2 - (lH.y + rH.y) / 2);
  const arm = upperArmTorsos * torso * (1 + FOREARM_SHARE);
  return sh.y + arm * Math.cos((targetDeg * Math.PI) / 180);
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
  ctx.font = "600 15px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const ly = y - 14;
  ctx.fillStyle = "rgba(10,14,30,0.72)";
  ctx.beginPath();
  (ctx as any).roundRect?.(cx - tw / 2 - 10, ly - 18, tw + 20, 26, 8) ?? ctx.rect(cx - tw / 2 - 10, ly - 18, tw + 20, 26);
  ctx.fill();
  ctx.fillStyle = `rgba(${col},1)`;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, ly);
  ctx.restore();
}
