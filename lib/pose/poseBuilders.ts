// lib/pose/poseBuilders.ts
// Ghost silhouette builders — parametric, driven by ROM target degrees.
// Shared by PoseDemoRunner and SessionRunner.
//
// ROM ARCHITECTURE:
//   ghostTargetDegrees = session_block_exercise.rom_target_degrees
//                        ?? exercise_template.rom_norm_degrees
//                        ?? exercise_template.rom_max_degrees
//
// The ghost always shows the patient's actual prescribed target, never
// an unreachable 180deg ideal. Physios set per-patient targets at
// session assignment. System norms are evidence-based (flexion 160deg,
// abduction 150deg per Gill et al. 2020 population study).
//
// COORDINATE MAPPING:
//   Degrees -> spine-frame 'along' value (negative = above shoulders):
//     0deg   = arm at side   (along = +0.85)
//     90deg  = horizontal    (along = +0.05 for abduction, -0.45 for flexion)
//     160deg = norm overhead (along = -0.80)
//     180deg = full overhead (along = -1.00)
//
//   Formula: along = lerp(+0.85, -1.0, deg / 180)

import {
  type BodyFrame, type Vec2,
  framePoint, limbPoint
} from './bodyFrame';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GhostJoints = {
  lShoulder: Vec2; rShoulder: Vec2;
  lElbow: Vec2;    rElbow: Vec2;
  lWrist: Vec2;    rWrist: Vec2;
  lHip: Vec2;      rHip: Vec2;
  lKnee: Vec2;     rKnee: Vec2;
  lAnkle: Vec2;    rAnkle: Vec2;
};

export type PoseBuilder = (f: BodyFrame, targetDeg?: number) => GhostJoints;

// ─── ROM -> spine-frame coordinate mapping ────────────────────────────────────

// Maps 0-180deg to the 'along' axis value.
// 0deg (arm at side) = along +0.85
// 180deg (full overhead) = along -1.0
function romToAlong(deg: number): number {
  const clamped = Math.max(0, Math.min(180, deg));
  return 0.85 - (clamped / 180) * 1.85;
}

// Maps 0-180deg abduction to lateral spread.
// 0deg = at side (across 0.18)
// 90deg = horizontal (across 1.0)
// 180deg = full overhead (across 0.0, arm crosses midline)
function romToAcross(deg: number, side: 1 | -1): number {
  const clamped = Math.max(0, Math.min(180, deg));
  let across: number;
  if (clamped <= 90) {
    across = 0.18 + (clamped / 90) * 0.82;
  } else {
    across = 1.0 - ((clamped - 90) / 90) * 0.90;
  }
  return across * side;
}

// ─── Shared sub-builders ─────────────────────────────────────────────────────

export function standingBase(f: BodyFrame): Partial<GhostJoints> {
  const rHip   = framePoint(f, 1.0,  0.40);
  const lHip   = framePoint(f, 1.0, -0.40);
  const rKnee  = limbPoint(f, rHip,  1, 0.05,  f.rThigh);
  const lKnee  = limbPoint(f, lHip,  1, -0.05, f.lThigh);
  const rAnkle = limbPoint(f, rKnee, 1, 0.03,  f.rShin);
  const lAnkle = limbPoint(f, lKnee, 1, -0.03, f.lShin);
  return { rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
}

export function restingArm(f: BodyFrame, side: 'r' | 'l'): { elbow: Vec2; wrist: Vec2 } {
  const sign = side === 'r' ? 1 : -1;
  const shoulder = framePoint(f, 0, sign * 0.5);
  const elbow = limbPoint(f, shoulder, 0.85, sign * 0.18, side === 'r' ? f.rUpperArm : f.lUpperArm);
  const wrist = limbPoint(f, elbow,    0.90, sign * 0.08, side === 'r' ? f.rForeArm  : f.lForeArm);
  return { elbow, wrist };
}

// ─── POSE_BUILDERS — target positions ────────────────────────────────────────
// Each builder accepts optional targetDeg (defaults to clinical norm).
// Ghost position scales continuously with the prescribed ROM.

export const POSE_BUILDERS: Record<string, PoseBuilder> = {

  // Shoulder Flexion — sagittal plane, arm forward and up
  shoulder_flexion_right: (f, targetDeg = 160) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const along = romToAlong(targetDeg);
    const rElbow = limbPoint(f, rShoulder, along, 0.15, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,    along, 0.10, f.rForeArm);
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },

  shoulder_flexion_left: (f, targetDeg = 160) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const along = romToAlong(targetDeg);
    const lElbow = limbPoint(f, lShoulder, along, -0.15, f.lUpperArm);
    const lWrist = limbPoint(f, lElbow,    along, -0.10, f.lForeArm);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },

  shoulder_flexion_bilateral: (f, targetDeg = 160) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const along = romToAlong(targetDeg);
    const rElbow = limbPoint(f, rShoulder, along,  0.15, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,    along,  0.10, f.rForeArm);
    const lElbow = limbPoint(f, lShoulder, along, -0.15, f.lUpperArm);
    const lWrist = limbPoint(f, lElbow,    along, -0.10, f.lForeArm);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },

  // Shoulder Abduction — frontal plane, arm out to the side
  shoulder_abduction_right: (f, targetDeg = 150) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const along  = romToAlong(targetDeg);
    const across = romToAcross(targetDeg, 1);
    const rElbow = limbPoint(f, rShoulder, along, across, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,    along * 0.9, across, f.rForeArm);
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },

  shoulder_abduction_left: (f, targetDeg = 150) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const along  = romToAlong(targetDeg);
    const across = romToAcross(targetDeg, -1);
    const lElbow = limbPoint(f, lShoulder, along, across, f.lUpperArm);
    const lWrist = limbPoint(f, lElbow,    along * 0.9, across, f.lForeArm);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },

  shoulder_abduction_bilateral: (f, targetDeg = 150) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const along   = romToAlong(targetDeg);
    const acrossR = romToAcross(targetDeg,  1);
    const acrossL = romToAcross(targetDeg, -1);
    const rElbow = limbPoint(f, rShoulder, along, acrossR, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,    along * 0.9, acrossR, f.rForeArm);
    const lElbow = limbPoint(f, lShoulder, along, acrossL, f.lUpperArm);
    const lWrist = limbPoint(f, lElbow,    along * 0.9, acrossL, f.lForeArm);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },

  // Sit to Stand — hip + knee extension
  sit_to_stand: (f, targetDeg = 170) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const rElbow = limbPoint(f, rShoulder, 0.9,  0.2, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,    0.8,  0.1, f.rForeArm);
    const lElbow = limbPoint(f, lShoulder, 0.9, -0.2, f.lUpperArm);
    const lWrist = limbPoint(f, lElbow,    0.8, -0.1, f.lForeArm);
    // Scale leg extension with ROM target
    const extFraction = Math.max(0, Math.min(1, (targetDeg - 90) / 90));
    const rHip   = framePoint(f, 1.0,  0.40);
    const lHip   = framePoint(f, 1.0, -0.40);
    const rKnee  = limbPoint(f, rHip,  1.0 - extFraction * 0.1,  0.05 + extFraction * 0.02, f.rThigh);
    const lKnee  = limbPoint(f, lHip,  1.0 - extFraction * 0.1, -0.05 - extFraction * 0.02, f.lThigh);
    const rAnkle = limbPoint(f, rKnee, 1.0,  0.03, f.rShin);
    const lAnkle = limbPoint(f, lKnee, 1.0, -0.03, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },

  // Knee Extension — seated, right leg
  knee_extension_right: (f, targetDeg = 160) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const extFraction = Math.max(0, Math.min(1, (targetDeg - 90) / 90));
    const rHip   = framePoint(f, 0.90,  0.38);
    const lHip   = framePoint(f, 0.90, -0.38);
    // Right leg extends outward as ROM increases
    const rKneeAlong  = 0.08 - extFraction * 0.03;
    const rKneeAcross = 0.5  + extFraction * 0.5;
    const rKnee  = limbPoint(f, rHip, rKneeAlong, rKneeAcross, f.rThigh);
    const rAnkle = limbPoint(f, rKnee, rKneeAlong * 0.8, rKneeAcross, f.rShin);
    // Left leg stays seated
    const lKnee  = limbPoint(f, lHip,  0.08, -0.9, f.lThigh);
    const lAnkle = limbPoint(f, lKnee, 1.0,  -0.05, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },
};

// ─── REST_BUILDERS — starting positions (arms at side, seated etc) ────────────
// These are the resting pose the ghost animates FROM during the demo phase.
// They don't use targetDeg — they always show the natural resting position.

export const REST_BUILDERS: Record<string, PoseBuilder> = {
  shoulder_flexion_right: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },
  shoulder_flexion_left: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },
  shoulder_flexion_bilateral: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },
  shoulder_abduction_right: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },
  shoulder_abduction_left: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },
  shoulder_abduction_bilateral: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...standingBase(f) } as GhostJoints;
  },
  sit_to_stand: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const rHip   = framePoint(f, 0.90,  0.38);
    const lHip   = framePoint(f, 0.90, -0.38);
    const rKnee  = limbPoint(f, rHip,  0.08,  0.9, f.rThigh);
    const lKnee  = limbPoint(f, lHip,  0.08, -0.9, f.lThigh);
    const rAnkle = limbPoint(f, rKnee, 1.0,  0.05, f.rShin);
    const lAnkle = limbPoint(f, lKnee, 1.0, -0.05, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },
  knee_extension_right: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const rHip   = framePoint(f, 0.90,  0.38);
    const lHip   = framePoint(f, 0.90, -0.38);
    const rKnee  = limbPoint(f, rHip,  0.08,  0.9, f.rThigh);
    const lKnee  = limbPoint(f, lHip,  0.08, -0.9, f.lThigh);
    const rAnkle = limbPoint(f, rKnee, 1.0,  0.05, f.rShin);
    const lAnkle = limbPoint(f, lKnee, 1.0, -0.05, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },
};

// ─── Match scoring ────────────────────────────────────────────────────────────
// Weighted joint angle scoring against target degrees.
// Returns 0.0 (no match) to 1.0 (perfect match).

export type MatchJoint = {
  name: string;
  a: number; b: number; c: number;
  targetDeg: number; toleranceDeg: number; weight: number;
};

export const MATCH_JOINTS: Record<string, MatchJoint[]> = {
  shoulder_flexion_right: [
    { name: 'shoulder flexion', a: 24, b: 12, c: 14, targetDeg: 90,  toleranceDeg: 18, weight: 0.7 },
    { name: 'elbow extension',  a: 12, b: 14, c: 16, targetDeg: 170, toleranceDeg: 18, weight: 0.3 },
  ],
  shoulder_flexion_left: [
    { name: 'shoulder flexion', a: 23, b: 11, c: 13, targetDeg: 90,  toleranceDeg: 18, weight: 0.7 },
    { name: 'elbow extension',  a: 11, b: 13, c: 15, targetDeg: 170, toleranceDeg: 18, weight: 0.3 },
  ],
  shoulder_flexion_bilateral: [
    { name: 'right shoulder', a: 24, b: 12, c: 14, targetDeg: 90,  toleranceDeg: 20, weight: 0.30 },
    { name: 'left shoulder',  a: 23, b: 11, c: 13, targetDeg: 90,  toleranceDeg: 20, weight: 0.30 },
    { name: 'right elbow',    a: 12, b: 14, c: 16, targetDeg: 170, toleranceDeg: 20, weight: 0.20 },
    { name: 'left elbow',     a: 11, b: 13, c: 15, targetDeg: 170, toleranceDeg: 20, weight: 0.20 },
  ],
  shoulder_abduction_right: [
    { name: 'shoulder abduction', a: 24, b: 12, c: 14, targetDeg: 90,  toleranceDeg: 18, weight: 0.7 },
    { name: 'elbow extension',    a: 12, b: 14, c: 16, targetDeg: 170, toleranceDeg: 18, weight: 0.3 },
  ],
  shoulder_abduction_left: [
    { name: 'shoulder abduction', a: 23, b: 11, c: 13, targetDeg: 90,  toleranceDeg: 18, weight: 0.7 },
    { name: 'elbow extension',    a: 11, b: 13, c: 15, targetDeg: 170, toleranceDeg: 18, weight: 0.3 },
  ],
  shoulder_abduction_bilateral: [
    { name: 'right shoulder', a: 24, b: 12, c: 14, targetDeg: 90,  toleranceDeg: 20, weight: 0.30 },
    { name: 'left shoulder',  a: 23, b: 11, c: 13, targetDeg: 90,  toleranceDeg: 20, weight: 0.30 },
    { name: 'right elbow',    a: 12, b: 14, c: 16, targetDeg: 170, toleranceDeg: 20, weight: 0.20 },
    { name: 'left elbow',     a: 11, b: 13, c: 15, targetDeg: 170, toleranceDeg: 20, weight: 0.20 },
  ],
  sit_to_stand: [
    { name: 'right knee', a: 24, b: 26, c: 28, targetDeg: 170, toleranceDeg: 15, weight: 0.30 },
    { name: 'left knee',  a: 23, b: 25, c: 27, targetDeg: 170, toleranceDeg: 15, weight: 0.30 },
    { name: 'right hip',  a: 12, b: 24, c: 26, targetDeg: 170, toleranceDeg: 15, weight: 0.20 },
    { name: 'left hip',   a: 11, b: 23, c: 25, targetDeg: 170, toleranceDeg: 15, weight: 0.20 },
  ],
  knee_extension_right: [
    { name: 'knee extension', a: 24, b: 26, c: 28, targetDeg: 170, toleranceDeg: 12, weight: 0.8 },
    { name: 'hip angle',      a: 12, b: 24, c: 26, targetDeg: 95,  toleranceDeg: 18, weight: 0.2 },
  ],
};

export function computeMatchScore(
  lms: { x: number; y: number; visibility?: number }[],
  slug: string,
  w: number, h: number
): number {
  const joints = MATCH_JOINTS[slug];
  if (!joints) return 0;
  let tw = 0; let sc = 0;
  for (const j of joints) {
    const a = lms[j.a]; const b = lms[j.b]; const c = lms[j.c];
    if (!b || !c || (b.visibility ?? 1) < 0.25 || (c.visibility ?? 1) < 0.25) continue;
    const pA = a && (a.visibility ?? 1) > 0.25
      ? { x: a.x * w, y: a.y * h }
      : { x: b.x * w, y: b.y * h + 100 };
    const pB = { x: b.x * w, y: b.y * h };
    const pC = { x: c.x * w, y: c.y * h };
    const ba = { x: pA.x - pB.x, y: pA.y - pB.y };
    const bc = { x: pC.x - pB.x, y: pC.y - pB.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const mag = Math.sqrt(ba.x ** 2 + ba.y ** 2) * Math.sqrt(bc.x ** 2 + bc.y ** 2);
    const angle = mag < 0.001 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
    const delta = Math.abs(angle - j.targetDeg);
    sc += Math.max(0, 1 - delta / (j.toleranceDeg * 2)) * j.weight;
    tw += j.weight;
  }
  return tw > 0 ? sc / tw : 0;
}

// ─── Ghost lerp ───────────────────────────────────────────────────────────────

import { lerpV } from './bodyFrame';

export function lerpGhost(a: GhostJoints, b: GhostJoints, t: number): GhostJoints {
  const keys = Object.keys(a) as (keyof GhostJoints)[];
  const out = {} as GhostJoints;
  for (const key of keys) out[key] = lerpV(a[key], b[key], t);
  return out;
}
