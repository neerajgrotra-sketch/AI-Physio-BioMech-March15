// lib/pose/ghostDrawers.ts
// ============================================================
// Pure canvas draw functions — one per GhostDrawMode.
//
// Each function:
//   - receives the canvas context, landmarks, ghostT, colour
//   - draws its specific body segment(s)
//   - has NO knowledge of exercise type, phase, or animation
//
// To add a new exercise type:
//   1. Add a new drawMode to GhostDrawMode in ghostConfig.ts
//   2. Implement the function here
//   3. Add the case to dispatchGhostDraw() at the bottom
//   SessionRunner.tsx needs zero changes.
// ============================================================

import type { GhostConfig } from './ghostConfig';
import { computeAbductionTargetDir } from './ghostConfig';
import { LP, vis, type Landmark } from './bodyFrame';

export type DrawGhostParams = {
  ctx:              CanvasRenderingContext2D;
  config:           GhostConfig;
  lms:              Landmark[];          // mirrored, normalised landmarks
  ghostT:           number;             // 0–1 animation position
  opacity:          number;
  colorRGB:         { r: number; g: number; b: number };
  W:                number;             // canvas width px
  H:                number;             // canvas height px
  shoulderWidthPx:  number;             // smoothed shoulder width in canvas px
  torsoLenPx:       number;             // smoothed torso length in canvas px
  physioTargetDeg:  number | null;      // prescribed angle for angle-driven exercises
};

// ─── Colour helper ────────────────────────────────────────────────────────────

function col(rgb: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// ─── Segment visibility check ────────────────────────────────────────────────

function isVis(lm: Landmark | undefined): boolean {
  return !!lm && (lm.visibility ?? 1) > 0.25;
}

// ─── Shared arm/leg stroke helper ─────────────────────────────────────────────
// Draws two segments (shoulder→elbow→wrist or hip→knee→shin)
// with dashed stroke and joint dots.

function drawTwoSegments(
  ctx:      CanvasRenderingContext2D,
  p0:       { x: number; y: number },  // proximal joint (shoulder / knee)
  p1:       { x: number; y: number },  // mid joint    (elbow / knee when anchor is hip)
  p2:       { x: number; y: number },  // distal joint (wrist / ankle)
  stroke:   string,
  dotFill:  string,
): void {
  ctx.setLineDash([9, 5]);
  ctx.lineWidth  = 6;
  ctx.lineCap    = 'round';
  ctx.strokeStyle = stroke;

  ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  ctx.setLineDash([]);

  for (const [px, py, r] of [
    [p0.x, p0.y, 9],
    [p1.x, p1.y, 8],
    [p2.x, p2.y, 7],
  ] as [number, number, number][]) {
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle   = dotFill; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  }
}

// ─── shoulder_arm ─────────────────────────────────────────────────────────────
// Draws ghost arm(s): shoulder → elbow → wrist.
// Direction vectors interpolated from restDir → targetDir using ghostT.
// For 'frontal' plane (abduction), targetDir is computed from physioTargetDeg.

export function drawShoulderArm(p: DrawGhostParams): void {
  const { ctx, config, lms, ghostT, opacity, colorRGB, W, H, shoulderWidthPx, physioTargetDeg } = p;

  // Resolve target direction
  let tgtDir: { x: number; y: number };
  if (config.targetDir !== null) {
    tgtDir = config.targetDir;
  } else if (config.targetPlane === 'frontal' && physioTargetDeg !== null) {
    tgtDir = computeAbductionTargetDir(physioTargetDeg);
  } else {
    // Safe fallback — horizontal out
    tgtDir = { x: 1.0, y: 0.04 };
  }

  const restDir = config.restDir;
  // Interpolate direction linearly — normalisation done inside drawTwoSegments
  const dX = restDir.x + (tgtDir.x - restDir.x) * ghostT;
  const dY = restDir.y + (tgtDir.y - restDir.y) * ghostT;

  // Normalise
  const dm = Math.sqrt(dX * dX + dY * dY) || 1;
  const nx = dX / dm;
  const ny = dY / dm;

  const upperPx = shoulderWidthPx * config.segmentRatios.upper;
  const lowerPx = shoulderWidthPx * config.segmentRatios.lower;

  const stroke  = col(colorRGB, opacity);
  const dotFill = col(colorRGB, opacity);

  for (const side of config.sides) {
    const lmIdx = config.anchorLandmarkIndex[side];
    const anchorLm = lms[lmIdx];
    if (!isVis(anchorLm)) continue;

    const ax = anchorLm.x * W;
    const ay = anchorLm.y * H;

    // For the left side, mirror the X component of the direction
    const flipX = side === 'left' ? -1 : 1;

    const elX = ax + flipX * nx * upperPx;
    const elY = ay + ny * upperPx;
    const wrX = elX + flipX * nx * lowerPx;
    const wrY = elY + ny * lowerPx;

    drawTwoSegments(ctx, { x: ax, y: ay }, { x: elX, y: elY }, { x: wrX, y: wrY }, stroke, dotFill);
  }
}

// ─── hip_leg ──────────────────────────────────────────────────────────────────
// Draws ghost leg(s): hip → knee (on detected positions) → shin (animated).
// Thigh segment uses actual detected knee landmark if visible.

export function drawHipLeg(p: DrawGhostParams): void {
  const { ctx, config, lms, ghostT, opacity, colorRGB, W, H, shoulderWidthPx } = p;

  const restDir  = config.restDir;
  const tgtDir   = config.targetDir ?? { x: 0.85, y: 0.10 };

  const dX = restDir.x + (tgtDir.x - restDir.x) * ghostT;
  const dY = restDir.y + (tgtDir.y - restDir.y) * ghostT;
  const dm = Math.sqrt(dX * dX + dY * dY) || 1;
  const nx = dX / dm;
  const ny = dY / dm;

  const shinLenPx = shoulderWidthPx * 1.0; // shin ~= shoulder width as fallback

  const stroke  = col(colorRGB, opacity);
  const dotFill = col(colorRGB, opacity);

  for (const side of config.sides) {
    const hipIdx  = config.anchorLandmarkIndex[side];
    const kneeIdx = side === 'right' ? LP.RIGHT_KNEE : LP.LEFT_KNEE;

    const hipLm  = lms[hipIdx];
    const kneeLm = lms[kneeIdx];

    if (!isVis(hipLm)) continue;

    const hx = hipLm.x * W;
    const hy = hipLm.y * H;

    // Knee position — use detected landmark if visible, else estimate
    let kx: number, ky: number;
    if (isVis(kneeLm)) {
      kx = kneeLm.x * W;
      ky = kneeLm.y * H;
    } else {
      // Estimate knee below hip using shoulder width as proxy
      kx = hx;
      ky = hy + shoulderWidthPx * 1.1;
    }

    // Shin: extends from knee in animated direction
    // Left side mirrors the X component
    const flipX = side === 'left' ? -1 : 1;
    const sx = kx + flipX * nx * shinLenPx;
    const sy = ky + ny * shinLenPx;

    drawTwoSegments(ctx, { x: hx, y: hy }, { x: kx, y: ky }, { x: sx, y: sy }, stroke, dotFill);
  }
}

// ─── sts_rise ─────────────────────────────────────────────────────────────────
// Draws a vertical upward arrow from hip midpoint — shows the rise direction.
// ghostT controls arrow height (0 = no arrow, 1 = full rise height).

export function drawStsRise(p: DrawGhostParams): void {
  const { ctx, config, lms, ghostT, opacity, colorRGB, W, H, torsoLenPx } = p;

  const lhLm = lms[LP.LEFT_HIP];
  const rhLm = lms[LP.RIGHT_HIP];

  if (!isVis(lhLm) || !isVis(rhLm)) return;

  const hipMidX = (lhLm.x + rhLm.x) * 0.5 * W;
  const hipMidY = (lhLm.y + rhLm.y) * 0.5 * H;
  const arrowHeight = torsoLenPx * config.segmentRatios.upper * ghostT;
  const tipX = hipMidX;
  const tipY = hipMidY - arrowHeight;

  const stroke = col(colorRGB, opacity);
  const fill   = col(colorRGB, opacity);

  // Shaft
  ctx.setLineDash([9, 5]);
  ctx.lineWidth   = 8;
  ctx.strokeStyle = stroke;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(hipMidX, hipMidY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead (only when ghost is meaningfully extended)
  if (ghostT > 0.15) {
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 16, tipY + 22);
    ctx.lineTo(tipX + 16, tipY + 22);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // Hip origin dot
  ctx.beginPath();
  ctx.arc(hipMidX, hipMidY, 9, 0, Math.PI * 2);
  ctx.fillStyle   = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 2;
  ctx.stroke();
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
// The tick() loop calls this one function — no switch/if on exercise type.
// To add a new draw mode: add a case here + implement the function above.

export function dispatchGhostDraw(p: DrawGhostParams): void {
  switch (p.config.drawMode) {
    case 'shoulder_arm': drawShoulderArm(p); break;
    case 'hip_leg':      drawHipLeg(p);      break;
    case 'sts_rise':     drawStsRise(p);     break;
    // Future: case 'cervical_rotation': drawCervicalRotation(p); break;
    default:
      // Unknown draw mode — log once and skip
      console.warn(`[GhostDrawer] Unknown drawMode: ${(p.config as any).drawMode}`);
  }
}
