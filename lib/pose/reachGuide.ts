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

// A straight arm's hand is (1 + FOREARM) upper-arm lengths from the shoulder
// (lib/biomechanics/flexionView.ts uses the same proportion).
export const ARM_TO_HAND = 1.9;

/**
 * Where the HAND should be, for a straight arm at the target angle, facing the
 * camera (testers asked for a hand target): straight up from the shoulder's
 * position in the picture by (1 + forearm) upper-arm lengths x cos(target).
 * Frame fractions (x 0..1 unmirrored, y 0 top), or null if not known.
 */
export function handTargetPoint(
  frame: PoseFrame,
  side: "right" | "left",
  upperArmTorsos: number | null,
  targetDeg: number
): { x: number; y: number; radius: number } | null {
  if (!upperArmTorsos) return null;
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const sh = lm[`${side}_shoulder`];
  const torso = torsoLength(frame);
  if (!sh || (sh.score ?? 1) < 0.35 || torso === null) return null;
  const reach = upperArmTorsos * ARM_TO_HAND * torso;
  return {
    x: sh.x,
    y: sh.y + reach * Math.cos((targetDeg * Math.PI) / 180),
    radius: Math.max(0.035, torso * 0.16), // generous: the hand only needs to get there
  };
}

/**
 * The wrist's place relative to the shoulder, in torso lengths (x in true
 * image proportions, image directions: +x right, +y down). Recorded the
 * moment a rep reaches the target, it says where THIS patient's hand is
 * when the measured angle makes the target (the owner's run A-57EDFCAD: the
 * measured angle and the true geometry differ near the top, so a circle
 * from geometry alone sat well below the hand).
 */
export function handOffset(frame: PoseFrame, side: "right" | "left"): { dx: number; dy: number } | null {
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const sh = lm[`${side}_shoulder`], wr = lm[`${side}_wrist`];
  const torso = torsoLength(frame);
  if (!sh || !wr || (sh.score ?? 1) < 0.35 || (wr.score ?? 1) < 0.35 || torso === null || torso < 1e-3) return null;
  const A = frame.sourceWidth && frame.sourceHeight ? frame.sourceWidth / frame.sourceHeight : 16 / 9;
  return { dx: ((wr.x - sh.x) * A) / torso, dy: (wr.y - sh.y) / torso };
}

/** The middle of the recorded offsets (each axis), or null with none. */
export function medianOffset(samples: Array<{ dx: number; dy: number }>): { dx: number; dy: number } | null {
  if (samples.length === 0) return null;
  const mid = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  return { dx: mid(samples.map((s) => s.dx)), dy: mid(samples.map((s) => s.dy)) };
}

/** The hand target from a learned offset, placed on the patient's shoulder now. */
export function targetFromOffset(frame: PoseFrame, side: "right" | "left", off: { dx: number; dy: number }): { x: number; y: number; radius: number } | null {
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const sh = lm[`${side}_shoulder`];
  const torso = torsoLength(frame);
  if (!sh || (sh.score ?? 1) < 0.35 || torso === null) return null;
  const A = frame.sourceWidth && frame.sourceHeight ? frame.sourceWidth / frame.sourceHeight : 16 / 9;
  return { x: sh.x + (off.dx * torso) / A, y: sh.y + off.dy * torso, radius: Math.max(0.035, torso * 0.16) };
}

/** Whether the patient's hand is inside the target circle. */
export function handInTarget(frame: PoseFrame, side: "right" | "left", t: { x: number; y: number; radius: number }): boolean {
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const wr = lm[`${side}_wrist`];
  if (!wr || (wr.score ?? 1) < 0.35) return false;
  const A = frame.sourceWidth && frame.sourceHeight ? frame.sourceWidth / frame.sourceHeight : 16 / 9;
  return Math.hypot((wr.x - t.x) * A, wr.y - t.y) <= t.radius * 1.3;
}

/**
 * Draws the hand target: a pulsing amber circle where the hand should reach,
 * with "Hand here" on its outer side (away from the face); green with a tick
 * once the hand (or the arm's angle) gets there.
 */
export function drawHandTarget(
  ctx: CanvasRenderingContext2D,
  side: "right" | "left",
  t: { x: number; y: number; radius: number },
  reached: boolean,
  W: number,
  H: number,
  nowMs: number
): void {
  const out = side === "right" ? 1 : -1;
  const r = Math.max(28, t.radius * H);
  const cx = Math.max(r + 4, Math.min(W - r - 4, (1 - t.x) * W));
  const cy = Math.max(r + 4, Math.min(H - r - 4, t.y * H));
  const pulse = reached ? 1 : 0.6 + 0.4 * Math.sin(nowMs / 240);
  const col = reached ? "63,185,80" : "255,190,60";
  ctx.save();
  ctx.fillStyle = `rgba(${col},${0.18 * pulse})`;
  ctx.beginPath(); ctx.arc(cx, cy, r * (1 + 0.12 * (1 - pulse)), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(${col},0.95)`;
  ctx.lineWidth = 4;
  ctx.setLineDash(reached ? [] : [9, 6]);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  if (reached) {
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy); ctx.lineTo(cx - r * 0.08, cy + r * 0.28); ctx.lineTo(cx + r * 0.4, cy - r * 0.3); ctx.stroke();
  }
  const label = reached ? "That's it!" : "Hand here";
  ctx.font = "700 16px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  let lx = out > 0 ? cx + r + 10 : cx - r - 10 - tw;
  if (lx < 8 || lx + tw > W - 8) lx = Math.max(8, Math.min(W - tw - 8, cx - tw / 2)); // no room beside: centre it
  const ly = lx === cx - tw / 2 ? cy + r + 22 : cy + 6;
  ctx.fillStyle = "rgba(10,14,30,0.72)";
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(lx - 7, ly - 18, tw + 14, 24, 7) : ctx.rect(lx - 7, ly - 18, tw + 14, 24);
  ctx.fill();
  ctx.fillStyle = `rgba(${col},1)`;
  ctx.textAlign = "left";
  ctx.fillText(label, lx, ly);
  ctx.restore();
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
  nowMs: number,
  withLabel = true
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
  // Label just above the bar, anchored at its outer end (left off when the
  // hand target is shown: one thing to aim for).
  const label = !withLabel ? "" : reached ? "✓ Target" : "Elbow here";
  ctx.font = "700 16px Inter, system-ui, sans-serif";
  const tw = label ? ctx.measureText(label).width : 0;
  // Starts at the bar's inner end and runs OUTWARD, away from the face (it
  // used to be anchored at the outer end and run inward, across the face);
  // it only slides back if it would run off the frame.
  const lx = out > 0 ? Math.min(x1, W - tw - 8) : Math.max(x1 - tw, 8);
  if (label) {
    ctx.fillStyle = "rgba(10,14,30,0.72)";
    ctx.beginPath();
    (ctx as any).roundRect ? (ctx as any).roundRect(lx - 7, y - 30, tw + 14, 24, 7) : ctx.rect(lx - 7, y - 30, tw + 14, 24);
    ctx.fill();
    ctx.fillStyle = `rgba(${col},1)`;
    ctx.textAlign = "left";
    ctx.fillText(label, lx, y - 12);
  }
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
