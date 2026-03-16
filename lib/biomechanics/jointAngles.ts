import type { PoseLandmark } from "@/lib/types/pose";

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function getAngleABC(
  a?: PoseLandmark,
  b?: PoseLandmark,
  c?: PoseLandmark
): number | null {
  if (!a || !b || !c) return null;

  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magCB = Math.sqrt(cbx * cbx + cby * cby);

  if (magAB === 0 || magCB === 0) return null;

  const cosine = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return round(toDegrees(Math.acos(cosine)));
}

export function getSegmentAngleDeg(
  start?: PoseLandmark,
  end?: PoseLandmark
): number | null {
  if (!start || !end) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) return null;

  return round(toDegrees(Math.atan2(dy, dx)));
}

export function getAbsoluteVerticalAngleDeg(
  start?: PoseLandmark,
  end?: PoseLandmark
): number | null {
  if (!start || !end) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return null;

  const verticalUpX = 0;
  const verticalUpY = -1;

  const vx = dx / length;
  const vy = dy / length;

  const dot = vx * verticalUpX + vy * verticalUpY;
  const cosine = Math.max(-1, Math.min(1, dot));

  return round(toDegrees(Math.acos(cosine)));
}

export function getMidpoint(
  a?: PoseLandmark,
  b?: PoseLandmark
): PoseLandmark | null {
  if (!a || !b) return null;

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: a.z !== undefined && b.z !== undefined ? (a.z + b.z) / 2 : undefined
  };
}
