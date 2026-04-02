'use client';

// MediaPipe loaded via CDN. NO @mediapipe npm imports (webpack build failure).
import { useEffect, useRef, useState, useCallback } from 'react';

declare global { interface Window { Pose: any; Camera: any; } }

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed: ' + src));
    document.head.appendChild(s);
  });
}

// \u2500\u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
type Vec2 = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

const LP = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
  LEFT_KNEE: 25,     RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,    RIGHT_ANKLE: 28,
};

// \u2500\u2500\u2500 Body frame \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// We extract a local coordinate frame from the live skeleton.
// Origin = shoulder midpoint
// axisDown = unit vector from shoulder-mid toward hip-mid (spine direction)
// axisRight = unit vector pointing toward patient's RIGHT shoulder
//   (we compute this from actual shoulder positions, so it survives any tilt/rotation)
//
// All ghost positions are expressed as:
//   pos = origin + axisDown * (along * torsoLen) + axisRight * (across * shoulderWidth)
//
// This means ghost joints are always in the correct body-relative position
// regardless of camera angle, distance, or mirroring.

type BodyFrame = {
  origin: Vec2;       // shoulder midpoint in canvas px
  axisDown: Vec2;     // unit vector pointing down spine
  axisRight: Vec2;    // unit vector pointing toward patient RIGHT shoulder (in canvas)
  torsoLen: number;   // shoulder-mid to hip-mid in canvas px
  shoulderWidth: number;
  // Per-limb lengths in canvas px
  rUpperArm: number; rForeArm: number;
  lUpperArm: number; lForeArm: number;
  rThigh: number;    rShin: number;
  lThigh: number;    lShin: number;
};

function dist(a: Vec2, b: Vec2) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }
function norm(v: Vec2): Vec2 { const m = Math.sqrt(v.x**2+v.y**2); return m<0.001?{x:0,y:1}:{x:v.x/m,y:v.y/m}; }
function vis(lm: Landmark | undefined) { return !!lm && (lm.visibility ?? 1) > 0.25; }
function c(lm: Landmark, w: number, h: number): Vec2 { return { x: lm.x*w, y: lm.y*h }; }
function segLen(lms: Landmark[], a: number, b: number, w: number, h: number, fallback: number): number {
  if (!vis(lms[a]) || !vis(lms[b])) return fallback;
  return Math.max(dist(c(lms[a],w,h), c(lms[b],w,h)), 10);
}

function getBodyFrame(lms: Landmark[], w: number, h: number): BodyFrame | null {
  const ls = lms[LP.LEFT_SHOULDER]; const rs = lms[LP.RIGHT_SHOULDER];
  if (!vis(ls)||!vis(rs)) return null;

  const lsC = c(ls,w,h); const rsC = c(rs,w,h);
  const shoulderMid: Vec2 = { x:(lsC.x+rsC.x)/2, y:(lsC.y+rsC.y)/2 };
  const shoulderWidth = Math.max(dist(lsC, rsC), 20);

  // axisRight: after mirroring, patient RIGHT = lsC -> rsC is flipped, so right = rsC->lsC direction
  const axisRight = norm({ x: lsC.x - rsC.x, y: lsC.y - rsC.y });
  // axisDown: perpendicular, always pointing toward bottom of frame
  let axisDown: Vec2 = { x: -axisRight.y, y: axisRight.x };
  if (axisDown.y < 0) axisDown = { x: -axisDown.x, y: -axisDown.y };

  // Use real hips if visible, otherwise estimate (human proportion: torso ~1.4x shoulder width)
  const lh = lms[LP.LEFT_HIP]; const rh = lms[LP.RIGHT_HIP];
  let torsoLen: number;
  if (vis(lh) && vis(rh)) {
    const lhC = c(lh,w,h); const rhC = c(rh,w,h);
    const hipMid: Vec2 = { x:(lhC.x+rhC.x)/2, y:(lhC.y+rhC.y)/2 };
    torsoLen = Math.max(dist(shoulderMid, hipMid), 20);
  } else {
    torsoLen = shoulderWidth * 1.4;
  }

  return {
    origin: shoulderMid, axisDown, axisRight, torsoLen, shoulderWidth,
    rUpperArm: segLen(lms, LP.RIGHT_SHOULDER, LP.RIGHT_ELBOW, w, h, shoulderWidth * 0.8),
    rForeArm:  segLen(lms, LP.RIGHT_ELBOW,    LP.RIGHT_WRIST, w, h, shoulderWidth * 0.7),
    lUpperArm: segLen(lms, LP.LEFT_SHOULDER,  LP.LEFT_ELBOW,  w, h, shoulderWidth * 0.8),
    lForeArm:  segLen(lms, LP.LEFT_ELBOW,     LP.LEFT_WRIST,  w, h, shoulderWidth * 0.7),
    rThigh:    segLen(lms, LP.RIGHT_HIP,      LP.RIGHT_KNEE,  w, h, torsoLen*0.55),
    rShin:     segLen(lms, LP.RIGHT_KNEE,     LP.RIGHT_ANKLE, w, h, torsoLen*0.5),
    lThigh:    segLen(lms, LP.LEFT_HIP,       LP.LEFT_KNEE,   w, h, torsoLen*0.55),
    lShin:     segLen(lms, LP.LEFT_KNEE,      LP.LEFT_ANKLE,  w, h, torsoLen*0.5),
  };
}

// Place a point using the body frame:
// along  = fraction along axisDown  (positive = toward hips)
// across = fraction of shoulderWidth along axisRight (positive = patient right in canvas)
function framePoint(f: BodyFrame, along: number, across: number): Vec2 {
  return {
    x: f.origin.x + f.axisDown.x * along * f.torsoLen + f.axisRight.x * across * f.shoulderWidth,
    y: f.origin.y + f.axisDown.y * along * f.torsoLen + f.axisRight.y * across * f.shoulderWidth,
  };
}

// Place a point as a specific limb direction from a given origin.
// dir is a unit-vector in the body frame: {along, across}
// We convert to canvas space using axisDown and axisRight.
function limbPoint(f: BodyFrame, from: Vec2, alongDir: number, acrossDir: number, len: number): Vec2 {
  const mag = Math.sqrt(alongDir**2 + acrossDir**2) || 1;
  const ad = alongDir/mag; const ac = acrossDir/mag;
  return {
    x: from.x + (f.axisDown.x*ad + f.axisRight.x*ac) * len,
    y: from.y + (f.axisDown.y*ad + f.axisRight.y*ac) * len,
  };
}

// \u2500\u2500\u2500 Ghost joint positions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
type GhostJoints = {
  lShoulder: Vec2; rShoulder: Vec2;
  lElbow: Vec2;    rElbow: Vec2;
  lWrist: Vec2;    rWrist: Vec2;
  lHip: Vec2;      rHip: Vec2;
  lKnee: Vec2;     rKnee: Vec2;
  lAnkle: Vec2;    rAnkle: Vec2;
};

// Each exercise defines a function that builds ghost joints from the body frame.
// Directions are in body-frame coordinates:
//   along = spine direction (positive = toward feet)
//   across = lateral (positive = patient's RIGHT side, which is canvas left after mirror)
//
// Key reference values:
//   Shoulder positions: along=0, across=+/-0.5 (half of shoulderWidth)
//   Hip positions: along=1.0 (torsoLen down), across=+/-0.4
//   "Arm at side" upper arm: along=+1 (pointing down), across=0
//   "Arm abducted 90deg" upper arm: along=0, across=+/-1 (pointing laterally)

type PoseBuilder = (f: BodyFrame) => GhostJoints;

function standingBase(f: BodyFrame): Partial<GhostJoints> {
  // Shared standing lower body
  const rHip  = framePoint(f, 1.0,  0.40);
  const lHip  = framePoint(f, 1.0, -0.40);
  const rKnee = limbPoint(f, rHip,  1, 0.05, f.rThigh);
  const lKnee = limbPoint(f, lHip,  1, -0.05, f.lThigh);
  const rAnkle = limbPoint(f, rKnee, 1, 0.03, f.rShin);
  const lAnkle = limbPoint(f, lKnee, 1, -0.03, f.lShin);
  return { rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
}

function restingArm(f: BodyFrame, side: 'r'|'l'): { elbow: Vec2; wrist: Vec2 } {
  const sign = side === 'r' ? 1 : -1;
  const shoulder = framePoint(f, 0, sign * 0.5);
  const elbow = limbPoint(f, shoulder, 0.85, sign * 0.18, side === 'r' ? f.rUpperArm : f.lUpperArm);
  const wrist = limbPoint(f, elbow,    0.90, sign * 0.08, side === 'r' ? f.rForeArm  : f.lForeArm);
  return { elbow, wrist };
}

const POSE_BUILDERS: Record<string, PoseBuilder> = {

  shoulder_abduction: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    // Right arm abducted 90deg: upper arm points laterally (across=+1, along=0)
    const rElbow = limbPoint(f, rShoulder,  0.05, 1.0, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,     0.0,  1.0, f.rForeArm);
    // Left arm resting at side
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },

  shoulder_abduction_bilateral: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    // Both arms abducted 90deg laterally
    const rElbow = limbPoint(f, rShoulder,  0.05,  1.0, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow,     0.0,   1.0, f.rForeArm);
    const lElbow = limbPoint(f, lShoulder,  0.05, -1.0, f.lUpperArm);
    const lWrist = limbPoint(f, lElbow,     0.0,  -1.0, f.lForeArm);
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },

  shoulder_external_rotation: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    // Right upper arm hangs straight down (along=1, across=slight outward)
    const rElbow = limbPoint(f, rShoulder, 1.0, 0.05, f.rUpperArm);
    // Right forearm rotated out: points laterally away from body
    const rWrist = limbPoint(f, rElbow, 0.05, 1.0, f.rForeArm);
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },

  knee_extension: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    // Seated: hips slightly lower (along=0.9 to look seated), right leg extended forward
    const rHip = framePoint(f, 0.90,  0.38);
    const lHip = framePoint(f, 0.90, -0.38);
    // Right leg extended: knee goes forward/lateral, shin continues
    const rKnee  = limbPoint(f, rHip, 0.05, 0.9,  f.rThigh);  // knee extends outward-forward
    const rAnkle = limbPoint(f, rKnee, 0.05, 0.9, f.rShin);
    // Left leg bent at 90 (seated): thigh horizontal, shin downward
    const lKnee  = limbPoint(f, lHip, 0.08, -0.9, f.lThigh);
    const lAnkle = limbPoint(f, lKnee, 1.0, -0.05, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },

  knee_flexion: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const rHip  = framePoint(f, 1.0,  0.40);
    const lHip  = framePoint(f, 1.0, -0.40);
    // Right thigh straight down, shin bent back (upward behind)
    const rKnee  = limbPoint(f, rHip,  1.0,  0.05, f.rThigh);
    const rAnkle = limbPoint(f, rKnee, -0.9, 0.05, f.rShin); // shin pointing back+up
    // Left leg straight
    const lKnee  = limbPoint(f, lHip,  1.0, -0.05, f.lThigh);
    const lAnkle = limbPoint(f, lKnee, 1.0, -0.03, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },
};

// \u2500\u2500\u2500 Exercise definitions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
type Exercise = {
  id: string; name: string; description: string; cues: string[];
  matchJoints: { name: string; a: number; b: number; c: number; targetDeg: number; toleranceDeg: number; weight: number }[];
};

const EXERCISES: Exercise[] = [
  {
    id: 'shoulder_abduction_bilateral', name: 'Bilateral Shoulder Raise',
    description: 'Raise BOTH arms out to the side to shoulder height',
    cues: ['Stand or sit tall', 'Keep both elbows straight', 'Raise both arms out to the sides', 'Stop when arms are level with your shoulders'],
    matchJoints: [
      { name: 'right shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW,  targetDeg: 90, toleranceDeg: 20, weight: 0.4 },
      { name: 'left shoulder',  a: LP.LEFT_HIP,  b: LP.LEFT_SHOULDER,  c: LP.LEFT_ELBOW,   targetDeg: 90, toleranceDeg: 20, weight: 0.4 },
      { name: 'right elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 170, toleranceDeg: 20, weight: 0.1 },
      { name: 'left elbow',     a: LP.LEFT_SHOULDER,  b: LP.LEFT_ELBOW,  c: LP.LEFT_WRIST,  targetDeg: 170, toleranceDeg: 20, weight: 0.1 },
    ],
  },
  {
    id: 'shoulder_abduction', name: 'Shoulder Abduction (Right)',
    description: 'Raise your right arm out to the side to shoulder height',
    cues: ['Stand tall, feet shoulder-width apart','Keep your elbow straight','Raise your right arm out to the side','Stop when arm is level with your shoulder'],
    matchJoints: [
      { name: 'shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW,   targetDeg: 90,  toleranceDeg: 18, weight: 0.7 },
      { name: 'elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 170, toleranceDeg: 18, weight: 0.3 },
    ],
  },
  {
    id: 'shoulder_external_rotation', name: 'Shoulder External Rotation',
    description: 'Elbow at side, rotate your forearm outward',
    cues: ['Keep your elbow tucked into your side','Start with forearm across your body','Rotate your forearm outward','Hold at maximum comfortable rotation'],
    matchJoints: [
      { name: 'elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 90, toleranceDeg: 15, weight: 0.5 },
      { name: 'shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW,   targetDeg: 15, toleranceDeg: 12, weight: 0.5 },
    ],
  },
  {
    id: 'knee_extension', name: 'Knee Extension',
    description: 'Seated \u2014 straighten your leg fully',
    cues: ['Sit upright in your chair','Tighten your quadriceps','Slowly straighten your knee','Hold with leg fully extended'],
    matchJoints: [
      { name: 'knee', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE,    targetDeg: 170, toleranceDeg: 12, weight: 0.8 },
      { name: 'hip',  a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE, targetDeg: 95,  toleranceDeg: 18, weight: 0.2 },
    ],
  },
  {
    id: 'knee_flexion', name: 'Knee Flexion',
    description: 'Standing \u2014 bend your knee 90\u00b0 behind you',
    cues: ['Stand on your left leg','Hold a surface if needed','Keep your thighs level','Bend right knee to 90 degrees behind you'],
    matchJoints: [
      { name: 'knee', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE,    targetDeg: 90,  toleranceDeg: 18, weight: 0.8 },
      { name: 'hip',  a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE, targetDeg: 175, toleranceDeg: 15, weight: 0.2 },
    ],
  },
];

// \u2500\u2500\u2500 Match scoring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function angleBetween(a: Vec2, b: Vec2, cc: Vec2): number {
  const ba = { x: a.x-b.x, y: a.y-b.y }; const bc = { x: cc.x-b.x, y: cc.y-b.y };
  const dot = ba.x*bc.x+ba.y*bc.y;
  const mag = Math.sqrt(ba.x**2+ba.y**2)*Math.sqrt(bc.x**2+bc.y**2);
  return mag<0.001 ? 0 : Math.acos(Math.max(-1,Math.min(1,dot/mag)))*180/Math.PI;
}

function computeMatch(lms: Landmark[], ex: Exercise, w: number, h: number): number {
  let tw = 0; let sc = 0;
  for (const j of ex.matchJoints) {
    const a = lms[j.a]; const b = lms[j.b]; const cc = lms[j.c];
    if (!vis(b)||!vis(cc)) continue;
    // If anchor landmark (a) is not visible (e.g. hips off-screen), estimate from visible joints
    let pA: Vec2; let pB = c(b,w,h); let pC = c(cc,w,h);
    if (vis(a)) {
      pA = c(a,w,h);
    } else {
      // Use vertical direction from b as fallback anchor (assumes standing/seated upright)
      pA = { x: pB.x, y: pB.y + 100 };
    }
    const delta = Math.abs(angleBetween(pA, pB, pC) - j.targetDeg);
    sc += Math.max(0, 1-delta/(j.toleranceDeg*2))*j.weight;
    tw += j.weight;
  }
  return tw>0 ? sc/tw : 0;
}

// \u2500\u2500\u2500 Drawing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const GHOST_SEGS: [keyof GhostJoints, keyof GhostJoints][] = [
  ['lShoulder','rShoulder'],
  ['rShoulder','rElbow'],['rElbow','rWrist'],
  ['lShoulder','lElbow'],['lElbow','lWrist'],
  ['rShoulder','rHip'],['lShoulder','lHip'],
  ['lHip','rHip'],
  ['rHip','rKnee'],['rKnee','rAnkle'],
  ['lHip','lKnee'],['lKnee','lAnkle'],
];

const LIVE_SEGS: [number,number][] = [
  [LP.LEFT_SHOULDER,LP.RIGHT_SHOULDER],
  [LP.RIGHT_SHOULDER,LP.RIGHT_ELBOW],[LP.RIGHT_ELBOW,LP.RIGHT_WRIST],
  [LP.LEFT_SHOULDER,LP.LEFT_ELBOW],[LP.LEFT_ELBOW,LP.LEFT_WRIST],
  [LP.RIGHT_SHOULDER,LP.RIGHT_HIP],[LP.LEFT_SHOULDER,LP.LEFT_HIP],
  [LP.LEFT_HIP,LP.RIGHT_HIP],
  [LP.RIGHT_HIP,LP.RIGHT_KNEE],[LP.RIGHT_KNEE,LP.RIGHT_ANKLE],
  [LP.LEFT_HIP,LP.LEFT_KNEE],[LP.LEFT_KNEE,LP.LEFT_ANKLE],
];

function drawGhost(ctx: CanvasRenderingContext2D, g: GhostJoints, score: number) {
  // Colour interpolates blue -> green as score increases
  const t = score;
  const r = Math.floor(96  + (74  - 96)  * t);
  const gr= Math.floor(165 + (222 - 165) * t);
  const b = Math.floor(250 + (128 - 250) * t);
  const col = `rgba(${r},${gr},${b},`;

  // Torso fill
  ctx.beginPath();
  ctx.moveTo(g.lShoulder.x,g.lShoulder.y);
  ctx.lineTo(g.rShoulder.x,g.rShoulder.y);
  ctx.lineTo(g.rHip.x,g.rHip.y);
  ctx.lineTo(g.lHip.x,g.lHip.y);
  ctx.closePath();
  ctx.fillStyle = col+'0.07)'; ctx.fill();

  ctx.setLineDash([8,5]); ctx.lineWidth=4; ctx.lineCap='round';
  for (const [a,b2] of GHOST_SEGS) {
    ctx.beginPath(); ctx.moveTo(g[a].x,g[a].y); ctx.lineTo(g[b2].x,g[b2].y);
    ctx.strokeStyle = col+'0.6)'; ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const p of Object.values(g) as Vec2[]) {
    ctx.beginPath(); ctx.arc(p.x,p.y,7,0,Math.PI*2);
    ctx.fillStyle=col+'0.75)'; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.5; ctx.stroke();
  }
}

function drawLive(ctx: CanvasRenderingContext2D, lms: Landmark[], w: number, h: number, score: number) {
  const col = score>=0.85 ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.90)';
  ctx.setLineDash([]); ctx.lineWidth=3.5; ctx.lineCap='round';
  for (const [a,b] of LIVE_SEGS) {
    if (!vis(lms[a])||!vis(lms[b])) continue;
    ctx.beginPath(); ctx.moveTo(lms[a].x*w,lms[a].y*h); ctx.lineTo(lms[b].x*w,lms[b].y*h);
    ctx.strokeStyle=col; ctx.stroke();
  }
  [LP.LEFT_SHOULDER,LP.RIGHT_SHOULDER,LP.LEFT_ELBOW,LP.RIGHT_ELBOW,
   LP.LEFT_WRIST,LP.RIGHT_WRIST,LP.LEFT_HIP,LP.RIGHT_HIP,
   LP.LEFT_KNEE,LP.RIGHT_KNEE,LP.LEFT_ANKLE,LP.RIGHT_ANKLE].forEach(i=>{
    if (!vis(lms[i])) return;
    ctx.beginPath(); ctx.arc(lms[i].x*w,lms[i].y*h,6,0,Math.PI*2);
    ctx.fillStyle=col; ctx.fill();
  });
}

// \u2500\u2500\u2500 Viewport smoothing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Smoothed viewport state \u2014 persists across renders without causing re-renders
type Viewport = { scale: number; offsetX: number; offsetY: number };


// Demo-mode ghost: cyan/purple pulsing to signal "watch me"
function drawGhostDemo(ctx: CanvasRenderingContext2D, g: GhostJoints, t: number) {
  // Colour oscillates between cyan and purple to signal active demo
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 350);
  const r = Math.floor(96  + (167 - 96)  * pulse);
  const gr= Math.floor(165 + (139 - 165) * pulse);
  const b = Math.floor(250 + (250 - 250) * pulse);
  const col = `rgba(${r},${gr},${b},`;

  const torso = [g.lShoulder, g.rShoulder, g.rHip, g.lHip];
  ctx.beginPath(); ctx.moveTo(torso[0].x,torso[0].y);
  torso.slice(1).forEach(p=>ctx.lineTo(p.x,p.y)); ctx.closePath();
  ctx.fillStyle=col+'0.08)'; ctx.fill();

  const GHOST_SEGS: [keyof GhostJoints, keyof GhostJoints][] = [
    ['lShoulder','rShoulder'],['rShoulder','rElbow'],['rElbow','rWrist'],
    ['lShoulder','lElbow'],['lElbow','lWrist'],['rShoulder','rHip'],['lShoulder','lHip'],
    ['lHip','rHip'],['rHip','rKnee'],['rKnee','rAnkle'],['lHip','lKnee'],['lKnee','lAnkle'],
  ];
  ctx.setLineDash([6,4]); ctx.lineWidth=4.5; ctx.lineCap='round';
  for (const [a,b2] of GHOST_SEGS) {
    ctx.beginPath(); ctx.moveTo(g[a].x,g[a].y); ctx.lineTo(g[b2].x,g[b2].y);
    ctx.strokeStyle=col+'0.75)'; ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of Object.values(g) as Vec2[]) {
    ctx.beginPath(); ctx.arc(p.x,p.y,8,0,Math.PI*2);
    ctx.fillStyle=col+'0.85)'; ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=2; ctx.stroke();
  }
}

// \u2500\u2500\u2500 Exercise phase state machine \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
type ExercisePhase = 'demo' | 'attempt' | 'rep_complete';

// Ease in-out cubic
function easeInOut(t: number): number {
  return t < 0.5 ? 4*t*t*t : 1 - (-2*t+2)**3/2;
}

// Lerp two Vec2 values
function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x)*t, y: a.y + (b.y - a.y)*t };
}

// Lerp all ghost joints between two poses
function lerpGhost(a: GhostJoints, b: GhostJoints, t: number): GhostJoints {
  const k = Object.keys(a) as (keyof GhostJoints)[];
  const out = {} as GhostJoints;
  for (const key of k) out[key] = lerpV(a[key], b[key], t);
  return out;
}

// REST pose builders \u2014 natural standing/seated position for each exercise
const REST_BUILDERS: Record<string, (f: BodyFrame) => GhostJoints> = {
  shoulder_abduction_bilateral: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },
  shoulder_abduction: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },
  shoulder_external_rotation: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    // Start: elbow at side, forearm pointing forward/across body
    const rElbow = limbPoint(f, rShoulder, 1.0, 0.05, f.rUpperArm);
    const rWrist = limbPoint(f, rElbow, 0.05, -0.8, f.rForeArm); // forearm tucked across
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },
  knee_extension: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const rHip = framePoint(f, 0.90,  0.38);
    const lHip = framePoint(f, 0.90, -0.38);
    // Both legs bent seated \u2014 knee below hip, shin down
    const rKnee  = limbPoint(f, rHip, 0.08, 0.9, f.rThigh);
    const rAnkle = limbPoint(f, rKnee, 1.0, 0.05, f.rShin);
    const lKnee  = limbPoint(f, lHip, 0.08, -0.9, f.lThigh);
    const lAnkle = limbPoint(f, lKnee, 1.0, -0.05, f.lShin);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, rHip, lHip, rKnee, lKnee, rAnkle, lAnkle };
  },
  knee_flexion: (f) => {
    const rShoulder = framePoint(f, 0,  0.50);
    const lShoulder = framePoint(f, 0, -0.50);
    const { elbow: rElbow, wrist: rWrist } = restingArm(f, 'r');
    const { elbow: lElbow, wrist: lWrist } = restingArm(f, 'l');
    const base = standingBase(f);
    return { lShoulder, rShoulder, rElbow, rWrist, lElbow, lWrist, ...base } as GhostJoints;
  },
};

// \u2500\u2500 Animation timeline for DEMO phase \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Returns a 0-1 lerp value (rest->target) given elapsed seconds.
// One demo cycle: 1s at rest, 2s raise, 1.5s hold at top, 2s lower, 0.5s pause
// Total cycle: 7s. We run 2 cycles then freeze at target.
const DEMO_CYCLE_S       = 7;   // seconds per cycle
const DEMO_CYCLES_FIRST  = 2;   // full teaching demo: 2 cycles
const DEMO_CYCLES_REPEAT = 1;   // reminder demo: 1 cycle (quicker)

// Intent detection: score must rise by this much over INTENT_WINDOW frames
const INTENT_DELTA     = 0.10; // 10 percentage point rise = "they're trying"
const INTENT_MIN_SCORE = 0.20; // must be above noise floor to count as intent
const INTENT_WINDOW    = 20;   // frames to look back (~0.33s at 60fps)

function cycleT(elapsedS: number): number {
  const t = (elapsedS % DEMO_CYCLE_S) / DEMO_CYCLE_S;
  if      (t < 0.14) return 0;
  else if (t < 0.43) return easeInOut((t - 0.14) / 0.29);
  else if (t < 0.64) return 1;
  else if (t < 0.93) return 1 - easeInOut((t - 0.64) / 0.29);
  else               return 0;
}

function demoLerp(elapsedS: number, isRepeat: boolean): { t: number; done: boolean } {
  const cycles = isRepeat ? DEMO_CYCLES_REPEAT : DEMO_CYCLES_FIRST;
  const totalS = DEMO_CYCLE_S * cycles;
  if (elapsedS >= totalS) return { t: cycleT(totalS - 0.01), done: true };
  return { t: cycleT(elapsedS), done: false };
}

// \u2500\u2500\u2500 Component \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export default function PoseDemoRunner() {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef<number>(0);
  const landmarksRef = useRef<Landmark[]>([]);
  const exRef        = useRef<Exercise>(EXERCISES[0]);

  // Viewport state \u2014 stored in refs to avoid triggering re-renders each frame
  const viewportRef      = useRef<Viewport>({ scale:1, offsetX:0, offsetY:0 });
  const autoFrameRef     = useRef<boolean>(true);
  const manualZoomRef    = useRef<number>(1.0);

  const [exercise, setExercise]         = useState<Exercise>(EXERCISES[0]);
  const [score, setScore]               = useState(0);
  const [phase, setPhase]               = useState<ExercisePhase>('demo');
  const [holdSecs, setHoldSecs]         = useState(0);
  const [reps, setReps]                 = useState(0);
  const [cameraReady, setCameraReady]   = useState(false);
  const [cameraError, setCameraError]   = useState('');
  const [loading, setLoading]           = useState(true);
  const [showMenu, setShowMenu]         = useState(false);
  const [autoFrame, setAutoFrame]       = useState(true);
  const [manualZoom, setManualZoom]     = useState(1.0);
  const [showControls, setShowControls] = useState(false);
  // UI-facing phase info \u2014 updated from render loop via refs to avoid stale closures
  const [phaseLabel, setPhaseLabel]     = useState('Watch carefully\u2026');
  const [phaseColor, setPhaseColor]     = useState('#60a5fa');
  const [phaseBg, setPhaseBg]           = useState('rgba(96,165,250,0.12)');
  const [demoProgress, setDemoProgress] = useState(0); // 0-1 for demo progress bar

  // Phase tracking refs (read in renderLoop without stale closure)
  const phaseRef        = useRef<ExercisePhase>('demo');
  const phaseStartRef   = useRef<number>(performance.now());
  const holdRef         = useRef(0);
  const holdTimerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const lowScoreRef     = useRef<number>(0);    // seconds below 55% during attempt
  const isRepeatDemoRef = useRef<boolean>(false); // true = reminder cycle (1x), false = first demo (2x)
  const scoreHistoryRef = useRef<number[]>([]);   // rolling score buffer for intent detection

  useEffect(()=>{ exRef.current = exercise; },[exercise]);
  useEffect(()=>{ autoFrameRef.current = autoFrame; },[autoFrame]);
  useEffect(()=>{ manualZoomRef.current = manualZoom; },[manualZoom]);

  const startPhase = useCallback((p: ExercisePhase, repeat = false) => {
    phaseRef.current = p;
    phaseStartRef.current = performance.now();
    lowScoreRef.current = 0;
    holdRef.current = 0;
    scoreHistoryRef.current = []; // clear intent buffer on phase change
    if (p === 'demo') isRepeatDemoRef.current = repeat;
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    setPhase(p); setHoldSecs(0);
  }, []);

  // Hold timer \u2014 only runs during attempt when matched
  const startHoldTimer = useCallback(() => {
    if (holdTimerRef.current) return;
    holdTimerRef.current = setInterval(()=>{
      holdRef.current += 1; setHoldSecs(holdRef.current);
      if (holdRef.current >= 5) {
        clearInterval(holdTimerRef.current!); holdTimerRef.current = null;
        setReps(r => r+1);
        startPhase('rep_complete');
        setTimeout(()=>startPhase('attempt'), 1500);
      }
    }, 1000);
  }, [startPhase]);

  const stopHoldTimer = useCallback(() => {
    if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
    holdRef.current = 0; setHoldSecs(0);
  }, []);

  const renderLoop = useCallback(()=>{
    const video=videoRef.current; const canvas=canvasRef.current;
    if (!video||!canvas){ animRef.current=requestAnimationFrame(renderLoop); return; }
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const W=canvas.width; const H=canvas.height;

    ctx.clearRect(0,0,W,H);

    const lms=landmarksRef.current;
    const mir = lms.length>0 ? lms.map(lm=>({...lm, x:1-lm.x})) : [];

    // \u2500\u2500 Viewport auto-frame \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let targetScale = manualZoomRef.current;
    let targetOX = 0; let targetOY = 0;
    if (autoFrameRef.current && mir.length>0) {
      const visLms = mir.filter(lm=>(lm.visibility??1)>0.15);
      if (visLms.length>=2) {
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for (const lm of visLms) {
          minX=Math.min(minX,lm.x*W); maxX=Math.max(maxX,lm.x*W);
          minY=Math.min(minY,lm.y*H); maxY=Math.max(maxY,lm.y*H);
        }
        const padX=(maxX-minX)*0.35+20; const padY=(maxY-minY)*0.28+20;
        const bx=Math.max(0,minX-padX); const by=Math.max(0,minY-padY);
        const bw=Math.min(W,maxX+padX)-bx; const bh=Math.min(H,maxY+padY)-by;
        targetScale=Math.max(1.0,Math.min(4.0,Math.min(W/bw,H/bh)*manualZoomRef.current));
        targetOX=W/2-(bx+bw/2)*targetScale; targetOY=H/2-(by+bh/2)*targetScale;
      }
    }
    const LERP=0.07; const vp=viewportRef.current;
    vp.scale+=( targetScale-vp.scale)*LERP;
    vp.offsetX+=(targetOX-vp.offsetX)*LERP;
    vp.offsetY+=(targetOY-vp.offsetY)*LERP;

    // \u2500\u2500 Draw video \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    ctx.save();
    ctx.setTransform(vp.scale,0,0,vp.scale,vp.offsetX,vp.offsetY);
    ctx.save(); ctx.scale(-1,1); ctx.drawImage(video,-W,0,W,H); ctx.restore();
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(0,0,W,H);
    ctx.restore();

    if (mir.length>0) {
      const now = performance.now();
      const elapsed = (now - phaseStartRef.current) / 1000;
      const currentPhase = phaseRef.current;
      const s = computeMatch(mir, exRef.current, W, H);
      setScore(s);

      const frame = getBodyFrame(mir, W, H);

      ctx.save();
      ctx.setTransform(vp.scale,0,0,vp.scale,vp.offsetX,vp.offsetY);

      if (frame) {
        const targetBuilder = POSE_BUILDERS[exRef.current.id];
        const restBuilder   = REST_BUILDERS[exRef.current.id];

        if (targetBuilder && restBuilder) {
          const targetJoints = targetBuilder(frame);
          const restJoints   = restBuilder(frame);

          if (currentPhase === 'demo') {
            // \u2500\u2500 DEMO: animate silhouette + watch for patient intent \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            const isRepeat = isRepeatDemoRef.current;
            const { t, done } = demoLerp(elapsed, isRepeat);
            const totalS = DEMO_CYCLE_S * (isRepeat ? DEMO_CYCLES_REPEAT : DEMO_CYCLES_FIRST);
            setDemoProgress(Math.min(elapsed / totalS, 1));

            // \u2500\u2500 Intent detection: is score rising? \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            // Push current score into rolling history buffer
            const hist = scoreHistoryRef.current;
            hist.push(s);
            if (hist.length > INTENT_WINDOW) hist.shift();

            let patientIsAttempting = false;
            if (hist.length >= INTENT_WINDOW && s >= INTENT_MIN_SCORE) {
              const oldest = hist[0];
              const scoreDelta = s - oldest;
              // Meaningful rising trend over the window = intent
              if (scoreDelta >= INTENT_DELTA) patientIsAttempting = true;
            }

            if (patientIsAttempting) {
              // Patient started moving to match \u2014 pause demo immediately
              setPhaseLabel('Good \u2014 now hold that position!');
              setPhaseColor('#4ade80'); setPhaseBg('rgba(74,222,128,0.12)');
              isRepeatDemoRef.current = false; // next repeat will be reminder length
              startPhase('attempt');
            } else {
              // Draw animated ghost
              const ghostJoints = lerpGhost(restJoints, targetJoints, t);
              drawGhostDemo(ctx, ghostJoints, t);

              if (done) {
                // Demo finished naturally \u2014 switch to attempt
                setPhaseLabel('Your turn \u2014 match the pose');
                setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)');
                startPhase('attempt');
              } else {
                if (t < 0.05)      { setPhaseLabel(isRepeat?'Watch again\u2026':'Watch carefully\u2026');    setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)'); }
                else if (t < 0.95) { setPhaseLabel('Follow this movement');                         setPhaseColor('#a78bfa'); setPhaseBg('rgba(167,139,250,0.12)'); }
                else               { setPhaseLabel('Hold at the top');                              setPhaseColor('#a78bfa'); setPhaseBg('rgba(167,139,250,0.12)'); }
              }
            }

          } else if (currentPhase === 'attempt') {
            // \u2500\u2500 ATTEMPT: ghost frozen at target, score live \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            drawGhost(ctx, targetJoints, s);

            if (s >= 0.85) {
              lowScoreRef.current = 0;
              startHoldTimer();
              const h = holdRef.current;
              setPhaseLabel(`Great form \u2014 hold ${h}s / 5s`);
              setPhaseColor('#4ade80'); setPhaseBg('rgba(74,222,128,0.12)');
            } else {
              stopHoldTimer();
              // Track time spent too low
              lowScoreRef.current += (1/60); // ~60fps
              if (s >= 0.55) {
                setPhaseLabel('Almost there \u2014 keep adjusting');
                setPhaseColor('#fbbf24'); setPhaseBg('rgba(251,191,36,0.12)');
                lowScoreRef.current = 0; // reset low-score timer when getting close
              } else {
                setPhaseLabel('Match the blue silhouette');
                setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)');
              }
              // After 8 seconds struggling → repeat demo (shorter reminder cycle)
              if (lowScoreRef.current > 8) {
                setPhaseLabel('Let me show you again\u2026');
                setPhaseColor('#a78bfa'); setPhaseBg('rgba(167,139,250,0.12)');
                setDemoProgress(0);
                startPhase('demo', true); // true = repeat = 1 cycle only
              }
            }

          } else if (currentPhase === 'rep_complete') {
            // \u2500\u2500 REP COMPLETE: brief green flash \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            drawGhost(ctx, targetJoints, 1);
            setPhaseLabel('Rep complete \u2014 well done!');
            setPhaseColor('#4ade80'); setPhaseBg('rgba(74,222,128,0.12)');
          }
        }
      }

      drawLive(ctx, mir, W, H, s);
      ctx.restore();
    }

    animRef.current=requestAnimationFrame(renderLoop);
  },[startHoldTimer, stopHoldTimer]);

  useEffect(()=>{
    let stopped=false;
    const init=async()=>{
      try {
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:640,height:480}});
        if(stopped){stream.getTracks().forEach(t=>t.stop());return;}
        if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();}
        setCameraReady(true);
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
        if(stopped) return;
        const pose=new window.Pose({locateFile:(f:string)=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`});
        pose.setOptions({modelComplexity:1,smoothLandmarks:true,enableSegmentation:false,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
        pose.onResults((r:any)=>{if(r.poseLandmarks) landmarksRef.current=r.poseLandmarks;});
        setLoading(false);
        const camera=new window.Camera(videoRef.current!,{
          onFrame:async()=>{await pose.send({image:videoRef.current!});},
          width:640,height:480,
        });
        camera.start();
        animRef.current=requestAnimationFrame(renderLoop);
      } catch(e:any){ setCameraError(e?.message??'Camera access denied'); setLoading(false); }
    };
    init();
    return ()=>{
      stopped=true; cancelAnimationFrame(animRef.current);
      if(videoRef.current?.srcObject)(videoRef.current.srcObject as MediaStream).getTracks().forEach(t=>t.stop());
    };
  },[renderLoop]);

  const pct=Math.round(score*100);

  const pick=(ex:Exercise)=>{
    setExercise(ex); setShowMenu(false); setReps(0); setScore(0);
    setPhaseLabel('Watch carefully\u2026'); setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)');
    setDemoProgress(0); setHoldSecs(0);
    isRepeatDemoRef.current=false; scoreHistoryRef.current=[];
    phaseRef.current='demo'; phaseStartRef.current=performance.now();
    lowScoreRef.current=0;
    if(holdTimerRef.current){ clearInterval(holdTimerRef.current); holdTimerRef.current=null; }
  };

  return (
    <div style={{height:'100dvh',background:'#080c14',fontFamily:"'DM Sans','SF Pro Display',system-ui,sans-serif",display:'flex',flexDirection:'column',color:'#f1f5f9',overflow:'hidden'}}>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,0.06)',background:'rgba(8,12,20,0.97)',backdropFilter:'blur(12px)',flexShrink:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:28,height:28,borderRadius:7,background:'linear-gradient(135deg,#3b82f6,#06b6d4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>
            &#x2b21;
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:700,letterSpacing:'-0.02em',lineHeight:1.2}}>Rehably</div>
            <div style={{fontSize:9,color:'#64748b',letterSpacing:'0.06em',textTransform:'uppercase'}}>Movement Guide</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{padding:'3px 10px',borderRadius:20,background:'rgba(59,130,246,0.12)',border:'1px solid rgba(59,130,246,0.25)',fontSize:12,fontWeight:700,color:'#60a5fa'}}>
            {reps} rep{reps!==1?'s':''}
          </div>
          <button onClick={()=>setShowMenu(m=>!m)} style={{padding:'5px 10px',borderRadius:8,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#cbd5e1',fontSize:11,fontWeight:500,cursor:'pointer',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {exercise.name} &#9662;
          </button>
        </div>
      </div>

      {/* Exercise menu */}
      {showMenu&&(
        <div style={{position:'fixed',top:56,right:10,left:10,zIndex:100,background:'#0f172a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.7)'}}>
          {EXERCISES.map(ex=>(
            <button key={ex.id} onClick={()=>pick(ex)} style={{width:'100%',display:'block',padding:'12px 16px',textAlign:'left',background:ex.id===exercise.id?'rgba(59,130,246,0.15)':'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.04)',color:ex.id===exercise.id?'#60a5fa':'#94a3b8',fontSize:13,fontWeight:500,cursor:'pointer'}}>
              {ex.name}
              <div style={{fontSize:11,color:'#475569',marginTop:2}}>{ex.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Camera - fills all available vertical space */}
      <div style={{flex:1,position:'relative',overflow:'hidden',minHeight:0}}>
        <video ref={videoRef} style={{display:'none'}} playsInline muted/>
        <canvas ref={canvasRef} width={640} height={480} style={{width:'100%',height:'100%',display:'block',background:'#0a0f1e'}}/>

        {/* Loading */}
        {loading&&(
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',borderRadius:0,gap:12}}>
            <div style={{width:40,height:40,borderRadius:'50%',border:'3px solid rgba(96,165,250,0.2)',borderTop:'3px solid #60a5fa',animation:'spin 0.8s linear infinite'}}/>
            <div style={{fontSize:13,color:'#64748b'}}>{cameraReady?'Loading pose detection\u2026':'Requesting camera\u2026'}</div>
          </div>
        )}

        {/* Camera error */}
        {cameraError&&(
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.92)',gap:8,padding:24}}>
            <div style={{fontSize:32}}>&#128247;</div>
            <div style={{fontSize:14,fontWeight:600,color:'#f87171'}}>Camera access needed</div>
            <div style={{fontSize:12,color:'#64748b',textAlign:'center'}}>{cameraError}</div>
          </div>
        )}

        {/* Score badge - top left */}
        {!loading&&!cameraError&&(
          <div style={{position:'absolute',top:14,left:14,background:'rgba(8,12,20,0.78)',backdropFilter:'blur(8px)',borderRadius:10,padding:'8px 12px',border:`1px solid ${phaseColor}40`,minWidth:80}}>
            <div style={{fontSize:22,fontWeight:800,color:phaseColor,lineHeight:1}}>{pct}%</div>
            <div style={{fontSize:10,color:'#64748b',marginTop:2}}>match</div>
            <div style={{marginTop:6,height:3,borderRadius:2,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:phaseColor,borderRadius:2,transition:'width 0.2s ease,background 0.3s ease'}}/>
            </div>
          </div>
        )}

        {/* Hold badge - top right */}
        {phase==='attempt'&&holdSecs>0&&(
          <div style={{position:'absolute',top:14,right:14,background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.4)',borderRadius:10,padding:'8px 12px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:'#4ade80',lineHeight:1}}>{holdSecs}s</div>
            <div style={{fontSize:10,color:'#64748b',marginTop:2}}>hold / 5s</div>
          </div>
        )}

        {/* Camera controls - bottom right */}
        {!loading&&!cameraError&&(
          <div style={{position:'absolute',bottom:14,right:14,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
            {showControls&&(
              <div style={{background:'rgba(8,12,20,0.88)',backdropFilter:'blur(12px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:'12px 14px',minWidth:200,display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                  <span style={{fontSize:12,color:'#94a3b8',fontWeight:500}}>Auto-frame</span>
                  <button onClick={()=>setAutoFrame(a=>!a)} style={{width:40,height:22,borderRadius:11,border:'none',cursor:'pointer',background:autoFrame?'#3b82f6':'rgba(255,255,255,0.12)',position:'relative',transition:'background 0.2s',flexShrink:0}}>
                    <span style={{position:'absolute',top:3,left:autoFrame?20:3,width:16,height:16,borderRadius:'50%',background:'#fff',transition:'left 0.2s',display:'block'}}/>
                  </button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontSize:12,color:'#94a3b8',fontWeight:500}}>Zoom</span>
                    <span style={{fontSize:12,color:'#60a5fa',fontWeight:600}}>{manualZoom.toFixed(1)}x</span>
                  </div>
                  <input type="range" min={0.5} max={3} step={0.05} value={manualZoom} onChange={e=>setManualZoom(Number(e.target.value))} style={{width:'100%',accentColor:'#3b82f6',cursor:'pointer'}}/>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#475569'}}>
                    <span>0.5x</span><span>3x</span>
                  </div>
                </div>
                <button onClick={()=>{ setManualZoom(1.0); setAutoFrame(true); }} style={{fontSize:11,color:'#64748b',background:'transparent',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,padding:'4px 0',cursor:'pointer'}}>
                  Reset to default
                </button>
              </div>
            )}
            <button onClick={()=>setShowControls(s=>!s)} style={{width:36,height:36,borderRadius:10,border:'none',cursor:'pointer',background:showControls?'rgba(59,130,246,0.3)':'rgba(8,12,20,0.75)',backdropFilter:'blur(8px)',color:'#94a3b8',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',outline:showControls?'1px solid rgba(59,130,246,0.5)':'1px solid rgba(255,255,255,0.08)'}}>
              &#9654;&#9650;
            </button>
          </div>
        )}

        {/* Auto-frame indicator - bottom left */}
        {!loading&&!cameraError&&autoFrame&&(
          <div style={{position:'absolute',bottom:14,left:14,display:'flex',alignItems:'center',gap:5,background:'rgba(8,12,20,0.72)',backdropFilter:'blur(6px)',borderRadius:20,padding:'4px 10px',border:'1px solid rgba(59,130,246,0.25)'}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#3b82f6',animation:'pulse 2s ease infinite'}}/>
            <span style={{fontSize:10,color:'#60a5fa',fontWeight:500,letterSpacing:'0.04em'}}>AUTO-FRAME</span>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div style={{flexShrink:0,background:'rgba(8,12,20,0.97)',borderTop:'1px solid rgba(255,255,255,0.06)',padding:'10px 14px 16px',display:'flex',flexDirection:'column',gap:8}}>

        {/* Phase status */}
        <div style={{display:'flex',alignItems:'center',gap:8,background:phaseBg,border:`1px solid ${phaseColor}40`,borderRadius:10,padding:'10px 14px',transition:'all 0.4s ease'}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:phaseColor,boxShadow:`0 0 8px ${phaseColor}`,animation:'pulse 1.5s ease infinite',flexShrink:0}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600,color:phaseColor}}>{phaseLabel}</div>
            {phase==='attempt'&&holdSecs>0&&(
              <div style={{fontSize:11,color:'#64748b',marginTop:1}}>Holding {holdSecs}s of 5s</div>
            )}
          </div>
          <div style={{padding:'2px 10px',borderRadius:20,background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.3)',fontSize:12,fontWeight:700,color:'#60a5fa',flexShrink:0}}>
            {reps} rep{reps!==1?'s':''}
          </div>
        </div>

        {/* Demo progress bar */}
        {phase==='demo'&&(
          <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(167,139,250,0.2)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:11,color:'#a78bfa',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>&#9654; Demo in progress</span>
              <span style={{fontSize:11,color:'#64748b'}}>{Math.round(demoProgress*100)}%</span>
            </div>
            <div style={{height:4,borderRadius:2,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${demoProgress*100}%`,background:'linear-gradient(90deg,#60a5fa,#a78bfa)',borderRadius:2,transition:'width 0.3s ease'}}/>
            </div>
            <div style={{fontSize:11,color:'#64748b',marginTop:6}}>Watch the silhouette, then match the movement</div>
          </div>
        )}

        {/* Match score - attempt phase */}
        {phase==='attempt'&&(
          <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px',display:'flex',alignItems:'center',gap:12}}>
            <div>
              <div style={{fontSize:22,fontWeight:800,color:phaseColor,lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:10,color:'#64748b',marginTop:1}}>match</div>
            </div>
            <div style={{flex:1}}>
              <div style={{height:6,borderRadius:3,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:phaseColor,borderRadius:3,transition:'width 0.15s ease,background 0.3s ease'}}/>
              </div>
              <div style={{fontSize:11,color:'#64748b',marginTop:5}}>
                {pct<55?'Keep trying \u2014 demo repeats if needed':pct<85?'Getting close!':'Hold this position'}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{display:'flex',gap:12,padding:'2px 0',fontSize:11,color:'#475569',flexWrap:'wrap'}}>
          {([['rgba(167,139,250,0.7)','Demo'],['rgba(96,165,250,0.7)','Target'],['rgba(255,255,255,0.7)','You'],['rgba(74,222,128,0.8)','\u2713 Match']] as const).map(([bg,label])=>(
            <span key={label} style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{display:'inline-block',width:10,height:3,background:bg,borderRadius:2}}/>{label}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin  { to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
      `}</style>
    </div>
  );
}
