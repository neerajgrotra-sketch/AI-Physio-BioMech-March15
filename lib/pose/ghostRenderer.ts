// lib/pose/ghostRenderer.ts
// Canvas drawing functions for ghost silhouette and live skeleton.
// Shared by PoseDemoRunner and SessionRunner.
// Pure functions — no React, no state.

import type { GhostJoints } from './poseBuilders';
import type { Vec2 } from './bodyFrame';

const GHOST_SEGS: [keyof GhostJoints, keyof GhostJoints][] = [
  ['lShoulder', 'rShoulder'],
  ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'],
  ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'],
  ['rShoulder', 'rHip'],  ['lShoulder', 'lHip'],
  ['lHip', 'rHip'],
  ['rHip', 'rKnee'],   ['rKnee', 'rAnkle'],
  ['lHip', 'lKnee'],   ['lKnee', 'lAnkle'],
];

const LIVE_PAIRS: [number, number][] = [
  [11, 12],
  [12, 14], [14, 16],
  [11, 13], [13, 15],
  [12, 24], [11, 23],
  [23, 24],
  [24, 26], [26, 28],
  [23, 25], [25, 27],
];

const LIVE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// ─── Ghost — frozen target (attempt phase) ────────────────────────────────────
// Colour interpolates blue -> green as match score rises.

export function drawGhost(
  ctx: CanvasRenderingContext2D,
  g: GhostJoints,
  score: number
): void {
  const t = score;
  const r  = Math.floor(96  + (74  - 96)  * t);
  const gr = Math.floor(165 + (222 - 165) * t);
  const b  = Math.floor(250 + (128 - 250) * t);
  const col = `rgba(${r},${gr},${b},`;

  // Torso fill
  ctx.beginPath();
  ctx.moveTo(g.lShoulder.x, g.lShoulder.y);
  ctx.lineTo(g.rShoulder.x, g.rShoulder.y);
  ctx.lineTo(g.rHip.x, g.rHip.y);
  ctx.lineTo(g.lHip.x, g.lHip.y);
  ctx.closePath();
  ctx.fillStyle = col + '0.07)';
  ctx.fill();

  ctx.setLineDash([8, 5]);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const [a, b2] of GHOST_SEGS) {
    ctx.beginPath();
    ctx.moveTo(g[a].x, g[a].y);
    ctx.lineTo(g[b2].x, g[b2].y);
    ctx.strokeStyle = col + '0.6)';
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of Object.values(g) as Vec2[]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = col + '0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ─── Ghost — animated demo (demo phase) ──────────────────────────────────────
// Pulses cyan/purple to signal 'watch me'.

export function drawGhostDemo(
  ctx: CanvasRenderingContext2D,
  g: GhostJoints,
  _t: number
): void {
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 350);
  const r  = Math.floor(96  + (167 - 96)  * pulse);
  const gr = Math.floor(165 + (139 - 165) * pulse);
  const b  = 250;
  const col = `rgba(${r},${gr},${b},`;

  const torso = [g.lShoulder, g.rShoulder, g.rHip, g.lHip];
  ctx.beginPath();
  ctx.moveTo(torso[0].x, torso[0].y);
  torso.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = col + '0.08)';
  ctx.fill();

  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  for (const [a, b2] of GHOST_SEGS) {
    ctx.beginPath();
    ctx.moveTo(g[a].x, g[a].y);
    ctx.lineTo(g[b2].x, g[b2].y);
    ctx.strokeStyle = col + '0.75)';
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of Object.values(g) as Vec2[]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = col + '0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ─── Live skeleton ────────────────────────────────────────────────────────────

export function drawLive(
  ctx: CanvasRenderingContext2D,
  lms: { x: number; y: number; visibility?: number }[],
  w: number, h: number,
  score: number
): void {
  const col = score >= 0.85 ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.90)';
  ctx.setLineDash([]);
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const [a, b] of LIVE_PAIRS) {
    const la = lms[a]; const lb = lms[b];
    if (!la || !lb || (la.visibility ?? 1) < 0.25 || (lb.visibility ?? 1) < 0.25) continue;
    ctx.beginPath();
    ctx.moveTo(la.x * w, la.y * h);
    ctx.lineTo(lb.x * w, lb.y * h);
    ctx.strokeStyle = col;
    ctx.stroke();
  }
  for (const i of LIVE_JOINTS) {
    const lm = lms[i];
    if (!lm || (lm.visibility ?? 1) < 0.25) continue;
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 6, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
}

// ─── Hold countdown ring ─────────────────────────────────────────────────────
// Drawn directly on canvas as the dominant visual when holding.
// Renders in the centre of the canvas over the video feed.

export function drawHoldRing(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  holdMs: number,        // elapsed hold time in ms
  targetMs: number,      // total required hold in ms
  score: number          // current match score (colours the ring)
): void {
  const pct = Math.min(1, holdMs / targetMs);
  const remaining = Math.max(0, Math.ceil((targetMs - holdMs) / 1000));
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.22;
  const strokeW = radius * 0.12;

  // Dark backdrop circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius + strokeW * 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,12,20,0.72)';
  ctx.fill();

  // Track ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = strokeW;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Progress arc — green when matched, blue otherwise
  const arcColor = score >= 0.85 ? '#4ade80' : '#7cc6ff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
  ctx.strokeStyle = arcColor;
  ctx.lineWidth = strokeW;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Centre countdown number
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(radius * 0.9)}px system-ui, sans-serif`;
  ctx.fillText(String(remaining), cx, cy - radius * 0.08);

  // 'hold' label below number
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `600 ${Math.round(radius * 0.28)}px system-ui, sans-serif`;
  ctx.fillText('HOLD', cx, cy + radius * 0.42);
}
