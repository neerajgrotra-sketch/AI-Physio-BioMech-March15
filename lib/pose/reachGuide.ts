// ============================================================
// lib/pose/reachGuide.ts
// ============================================================
// The front-view target marker for a forward arm raise: a short bar beside
// the raised arm at the height the ELBOW must reach for the target angle
// (shoulder.y + upperArm·cos θ, image y growing downward; the upper arm's
// length is the learned one from lib/biomechanics/flexionView.ts, in torso
// lengths), with a dot on the patient's own elbow. Green when reached.
// Pure: reachLineY is tested; drawReachGuide only draws.
// ============================================================

import type { PoseFrame } from "@/lib/types/pose";


/**
 * Where the ELBOW must reach for the target angle, as a fraction of the
 * frame height (0 top, 1 bottom), or null if not known. The elbow, not the
 * hand: the angle measured is the upper arm's, and with a bent elbow the
 * hand reached a hand-height line while the upper arm was far short (the
 * owner's test). elbow.y = shoulder.y + upperArm * cos(target).
 */
export function reachLineY(
  frame: PoseFrame,
  side: "right" | "left",
  upperArmTorsos: number | null,
  targetDeg: number
): number | null {
  if (!upperArmTorsos) return null;
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const sh = lm[`${side}_shoulder`];
  const torso = torsoLength(frame);
  if (!sh || (sh.score ?? 1) < 0.35 || torso === null) return null;
  return sh.y + upperArmTorsos * torso * Math.cos((targetDeg * Math.PI) / 180);
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
  const label = reached ? "✓ Target" : "Elbow here";
  ctx.font = "700 16px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  // Starts at the bar's inner end and runs OUTWARD, away from the face (it
  // used to be anchored at the outer end and run inward, across the face);
  // it only slides back if it would run off the frame.
  const lx = out > 0 ? Math.min(x1, W - tw - 8) : Math.max(x1 - tw, 8);
  ctx.fillStyle = "rgba(10,14,30,0.72)";
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(lx - 7, y - 30, tw + 14, 24, 7) : ctx.rect(lx - 7, y - 30, tw + 14, 24);
  ctx.fill();
  ctx.fillStyle = `rgba(${col},1)`;
  ctx.textAlign = "left";
  ctx.fillText(label, lx, y - 12);
  // A dot on the patient's own elbow, so they can see it travel to the line.
  const el = lm[`${side}_elbow`];
  if (el) {
    const ex = (1 - el.x) * W, ey = el.y * H;
    ctx.fillStyle = `rgba(${col},0.95)`;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ex, ey, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/**
 * Labels the arm the exercise uses ("RIGHT ARM") at that shoulder, in the
 * mirrored preview, so the patient needn't work out left and right in a
 * mirror. Shown before the first rep, and highlighted (red, pulsing) when
 * they lift the wrong arm.
 */
export function drawArmLabel(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  side: "right" | "left",
  W: number,
  H: number,
  urgent: boolean,
  nowMs: number
): void {
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const sh = lm[`${side}_shoulder`];
  if (!sh || (sh.score ?? 1) < 0.35) return;
  const x = (1 - sh.x) * W, y = sh.y * H;
  const pulse = urgent ? 0.6 + 0.4 * Math.sin(nowMs / 160) : 1;
  const col = urgent ? "255,90,90" : "96,190,250";
  ctx.save();
  // Ring on the shoulder.
  ctx.strokeStyle = `rgba(${col},${0.9 * pulse})`;
  ctx.lineWidth = urgent ? 5 : 3;
  ctx.beginPath(); ctx.arc(x, y, urgent ? 22 : 16, 0, Math.PI * 2); ctx.stroke();
  // Pill above it.
  const label = `${side.toUpperCase()} ARM`;
  ctx.font = "800 15px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const px = Math.max(6, Math.min(W - tw - 22, x - tw / 2 - 8)), py = Math.max(6, y - 56);
  ctx.fillStyle = `rgba(${col},${0.92 * pulse})`;
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(px, py, tw + 16, 24, 12) : ctx.rect(px, py, tw + 16, 24);
  ctx.fill();
  ctx.fillStyle = "rgba(10,14,30,0.95)";
  ctx.textAlign = "left";
  ctx.fillText(label, px + 8, py + 17);
  ctx.restore();
}
