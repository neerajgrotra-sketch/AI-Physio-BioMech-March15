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

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Body frame ───────────────────────────────────────────────────────────────
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

// ─── Ghost joint positions ────────────────────────────────────────────────────
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

// ─── Exercise definitions ─────────────────────────────────────────────────────
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

// ─── Match scoring ────────────────────────────────────────────────────────────
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

// ─── Drawing ──────────────────────────────────────────────────────────────────
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

// ─── Viewport smoothing ───────────────────────────────────────────────────────
// Smoothed viewport state — persists across renders without causing re-renders
type Viewport = { scale: number; offsetX: number; offsetY: number };

// ─── Component ────────────────────────────────────────────────────────────────
export default function PoseDemoRunner() {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef<number>(0);
  const landmarksRef = useRef<Landmark[]>([]);
  const exRef        = useRef<Exercise>(EXERCISES[0]);

  // Viewport state — stored in refs to avoid triggering re-renders each frame
  const viewportRef      = useRef<Viewport>({ scale:1, offsetX:0, offsetY:0 });
  const autoFrameRef     = useRef<boolean>(true);
  const manualZoomRef    = useRef<number>(1.0);

  const [exercise, setExercise]       = useState<Exercise>(EXERCISES[0]);
  const [score, setScore]             = useState(0);
  const [matchState, setMatchState]   = useState<'idle'|'tracking'|'close'|'matched'>('idle');
  const [holdSecs, setHoldSecs]       = useState(0);
  const [reps, setReps]               = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [loading, setLoading]         = useState(true);
  const [cueIdx, setCueIdx]           = useState(0);
  const [showMenu, setShowMenu]       = useState(false);
  const [autoFrame, setAutoFrame]     = useState(true);
  const [manualZoom, setManualZoom]   = useState(1.0);
  const [showControls, setShowControls] = useState(false);

  const holdRef      = useRef(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval>|null>(null);

  useEffect(()=>{ exRef.current = exercise; },[exercise]);
  useEffect(()=>{ autoFrameRef.current = autoFrame; },[autoFrame]);
  useEffect(()=>{ manualZoomRef.current = manualZoom; },[manualZoom]);

  useEffect(()=>{
    const id = setInterval(()=>setCueIdx(i=>(i+1)%exercise.cues.length),4000);
    return ()=>clearInterval(id);
  },[exercise]);

  useEffect(()=>{
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdRef.current=0; setHoldSecs(0);
    if (matchState==='matched') {
      holdTimerRef.current = setInterval(()=>{
        holdRef.current+=1; setHoldSecs(holdRef.current);
        if (holdRef.current>=5){ setReps(r=>r+1); holdRef.current=0; setHoldSecs(0); }
      },1000);
    }
    return ()=>{ if(holdTimerRef.current) clearInterval(holdTimerRef.current); };
  },[matchState]);

  const renderLoop = useCallback(()=>{
    const video=videoRef.current; const canvas=canvasRef.current;
    if (!video||!canvas){ animRef.current=requestAnimationFrame(renderLoop); return; }
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const W=canvas.width; const H=canvas.height;

    ctx.clearRect(0,0,W,H);

    const lms=landmarksRef.current;
    const mir = lms.length>0 ? lms.map(lm=>({...lm, x:1-lm.x})) : [];

    // ── Compute target viewport ───────────────────────────────────────────────
    let targetScale = manualZoomRef.current;
    let targetOX = 0; let targetOY = 0;

    if (autoFrameRef.current && mir.length>0) {
      // Find bounding box of all visible landmarks in canvas coordinates
      const visLms = mir.filter(lm=>(lm.visibility??1)>0.15);
      if (visLms.length>=2) {
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for (const lm of visLms) {
          minX=Math.min(minX,lm.x*W); maxX=Math.max(maxX,lm.x*W);
          minY=Math.min(minY,lm.y*H); maxY=Math.max(maxY,lm.y*H);
        }
        // Add generous padding so body doesn't feel cramped
        const padX = (maxX-minX)*0.35 + 20;
        const padY = (maxY-minY)*0.28 + 20;
        const bx = Math.max(0, minX-padX);
        const by = Math.max(0, minY-padY);
        const bw = Math.min(W, maxX+padX) - bx;
        const bh = Math.min(H, maxY+padY) - by;
        // Scale to fill canvas while keeping aspect ratio
        const fitScale = Math.min(W/bw, H/bh);
        // Apply manual zoom on top of auto-frame scale
        targetScale = fitScale * manualZoomRef.current;
        // Clamp: never zoom out beyond 1x, never over 4x
        targetScale = Math.max(1.0, Math.min(4.0, targetScale));
        // Centre the bounding box in canvas
        const centreX = bx + bw/2;
        const centreY = by + bh/2;
        targetOX = W/2 - centreX * targetScale;
        targetOY = H/2 - centreY * targetScale;
      }
    }

    // ── Exponential smoothing — feels like a real camera operator ─────────────
    const LERP = 0.07; // lower = smoother/slower, higher = snappier
    const vp = viewportRef.current;
    vp.scale   = vp.scale   + (targetScale - vp.scale)   * LERP;
    vp.offsetX = vp.offsetX + (targetOX    - vp.offsetX) * LERP;
    vp.offsetY = vp.offsetY + (targetOY    - vp.offsetY) * LERP;

    // ── Draw video with viewport transform ────────────────────────────────────
    ctx.save();
    ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
    ctx.save(); ctx.scale(-1,1); ctx.drawImage(video,-W,0,W,H); ctx.restore();
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(0,0,W,H);
    ctx.restore();

    // ── Draw skeleton overlays using same viewport transform ──────────────────
    if (mir.length>0) {
      const s = computeMatch(mir, exRef.current, W, H);
      setScore(s);
      setMatchState(s>=0.85?'matched':s>=0.55?'close':'tracking');

      ctx.save();
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);

      const frame = getBodyFrame(mir, W, H);
      if (frame) {
        const builder = POSE_BUILDERS[exRef.current.id];
        if (builder) drawGhost(ctx, builder(frame), s);
      }
      drawLive(ctx, mir, W, H, s);

      ctx.restore();
    }

    animRef.current=requestAnimationFrame(renderLoop);
  },[]);

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
  const STATE={
    idle:     {label:'Position yourself in frame',      color:'#94a3b8',bg:'rgba(148,163,184,0.12)'},
    tracking: {label:'Match the silhouette',            color:'#60a5fa',bg:'rgba(96,165,250,0.12)' },
    close:    {label:'Almost there \u2014 keep going',  color:'#fbbf24',bg:'rgba(251,191,36,0.12)' },
    matched:  {label:`Hold \u2014 ${holdSecs}s / 5s`,  color:'#4ade80',bg:'rgba(74,222,128,0.12)' },
  }[matchState];

  const pick=(ex:Exercise)=>{ setExercise(ex);setShowMenu(false);setReps(0);setScore(0);setMatchState('idle');setCueIdx(0); };

  return (
    <div style={{minHeight:'100vh',background:'#080c14',fontFamily:"'DM Sans','SF Pro Display',system-ui,sans-serif",display:'flex',flexDirection:'column',color:'#f1f5f9'}}>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',borderBottom:'1px solid rgba(255,255,255,0.06)',background:'rgba(8,12,20,0.95)',backdropFilter:'blur(12px)',position:'sticky',top:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#3b82f6,#06b6d4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>&#x2b21;</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,letterSpacing:'-0.02em'}}>Rehably</div>
            <div style={{fontSize:10,color:'#64748b',letterSpacing:'0.08em',textTransform:'uppercase'}}>Movement Guide</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{padding:'4px 12px',borderRadius:20,background:'rgba(59,130,246,0.12)',border:'1px solid rgba(59,130,246,0.25)',fontSize:13,fontWeight:600,color:'#60a5fa'}}>
            {reps} rep{reps!==1?'s':''}
          </div>
          <button onClick={()=>setShowMenu(m=>!m)} style={{padding:'6px 14px',borderRadius:8,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#cbd5e1',fontSize:12,fontWeight:500,cursor:'pointer'}}>
            {exercise.name} &#9662;
          </button>
        </div>
      </div>

      {/* Menu */}
      {showMenu&&(
        <div style={{position:'fixed',top:62,right:16,zIndex:100,background:'#0f172a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',minWidth:240}}>
          {EXERCISES.map(ex=>(
            <button key={ex.id} onClick={()=>pick(ex)} style={{width:'100%',display:'block',padding:'12px 16px',textAlign:'left',background:ex.id===exercise.id?'rgba(59,130,246,0.15)':'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.04)',color:ex.id===exercise.id?'#60a5fa':'#94a3b8',fontSize:13,fontWeight:500,cursor:'pointer'}}>
              {ex.name}
              <div style={{fontSize:11,color:'#475569',marginTop:2}}>{ex.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Camera */}
      <div style={{flex:1,display:'flex',flexDirection:'column'}}>
        <div style={{position:'relative',width:'100%',maxWidth:700,margin:'0 auto',aspectRatio:'4/3'}}>
          <video ref={videoRef} style={{display:'none'}} playsInline muted/>
          <canvas ref={canvasRef} width={640} height={480} style={{width:'100%',height:'100%',borderRadius:16,display:'block',background:'#0a0f1e'}}/>

          {/* ── Camera Controls Overlay ── */}
          {!loading&&!cameraError&&(
            <div style={{position:'absolute',bottom:14,right:14,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>

              {/* Zoom slider panel — shown when controls open */}
              {showControls&&(
                <div style={{background:'rgba(8,12,20,0.88)',backdropFilter:'blur(12px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:'12px 14px',minWidth:200,display:'flex',flexDirection:'column',gap:10}}>
                  {/* Auto-frame toggle */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                    <span style={{fontSize:12,color:'#94a3b8',fontWeight:500}}>Auto-frame</span>
                    <button
                      onClick={()=>setAutoFrame(a=>!a)}
                      style={{
                        width:40,height:22,borderRadius:11,border:'none',cursor:'pointer',
                        background:autoFrame?'#3b82f6':'rgba(255,255,255,0.12)',
                        position:'relative',transition:'background 0.2s',flexShrink:0,
                      }}
                    >
                      <span style={{
                        position:'absolute',top:3,left:autoFrame?20:3,
                        width:16,height:16,borderRadius:'50%',background:'#fff',
                        transition:'left 0.2s',display:'block',
                      }}/>
                    </button>
                  </div>

                  {/* Zoom slider */}
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:12,color:'#94a3b8',fontWeight:500}}>Zoom</span>
                      <span style={{fontSize:12,color:'#60a5fa',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{manualZoom.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range" min={0.5} max={3} step={0.05}
                      value={manualZoom}
                      onChange={e=>setManualZoom(Number(e.target.value))}
                      style={{width:'100%',accentColor:'#3b82f6',cursor:'pointer'}}
                    />
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#475569'}}>
                      <span>0.5x</span><span>3x</span>
                    </div>
                  </div>

                  {/* Reset */}
                  <button
                    onClick={()=>{ setManualZoom(1.0); setAutoFrame(true); }}
                    style={{fontSize:11,color:'#64748b',background:'transparent',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,padding:'4px 0',cursor:'pointer'}}
                  >
                    Reset to default
                  </button>
                </div>
              )}

              {/* Controls toggle button */}
              <button
                onClick={()=>setShowControls(s=>!s)}
                title="Camera controls"
                style={{
                  width:36,height:36,borderRadius:10,border:'none',cursor:'pointer',
                  background:showControls?'rgba(59,130,246,0.3)':'rgba(8,12,20,0.75)',
                  backdropFilter:'blur(8px)',
                  color:'#94a3b8',fontSize:16,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  boxShadow:'0 2px 8px rgba(0,0,0,0.4)',
                  outline:showControls?'1px solid rgba(59,130,246,0.5)':'1px solid rgba(255,255,255,0.08)',
                }}
              >
                &#9654;&#9650;
              </button>
            </div>
          )}

          {/* Auto-frame indicator pill */}
          {!loading&&!cameraError&&autoFrame&&(
            <div style={{position:'absolute',bottom:14,left:14,display:'flex',alignItems:'center',gap:5,background:'rgba(8,12,20,0.72)',backdropFilter:'blur(6px)',borderRadius:20,padding:'4px 10px',border:'1px solid rgba(59,130,246,0.25)'}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'#3b82f6',animation:'pulse 2s ease infinite'}}/>
              <span style={{fontSize:10,color:'#60a5fa',fontWeight:500,letterSpacing:'0.04em'}}>AUTO-FRAME</span>
            </div>
          )}

          {loading&&(
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',borderRadius:16,gap:12}}>
              <div style={{width:40,height:40,borderRadius:'50%',border:'3px solid rgba(96,165,250,0.2)',borderTop:'3px solid #60a5fa',animation:'spin 0.8s linear infinite'}}/>
              <div style={{fontSize:13,color:'#64748b'}}>{cameraReady?'Loading pose detection\u2026':'Requesting camera\u2026'}</div>
            </div>
          )}

          {cameraError&&(
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.92)',borderRadius:16,gap:8,padding:24}}>
              <div style={{fontSize:32}}>&#128247;</div>
              <div style={{fontSize:14,fontWeight:600,color:'#f87171'}}>Camera access needed</div>
              <div style={{fontSize:12,color:'#64748b',textAlign:'center'}}>{cameraError}</div>
            </div>
          )}

          {!loading&&!cameraError&&(
            <div style={{position:'absolute',top:14,left:14,background:'rgba(8,12,20,0.78)',backdropFilter:'blur(8px)',borderRadius:10,padding:'8px 12px',border:`1px solid ${STATE.color}40`,minWidth:80}}>
              <div style={{fontSize:22,fontWeight:800,color:STATE.color,lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:10,color:'#64748b',marginTop:2}}>match</div>
              <div style={{marginTop:6,height:3,borderRadius:2,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:STATE.color,borderRadius:2,transition:'width 0.2s ease,background 0.3s ease'}}/>
              </div>
            </div>
          )}

          {matchState==='matched'&&(
            <div style={{position:'absolute',top:14,right:14,background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.4)',borderRadius:10,padding:'8px 12px',textAlign:'center'}}>
              <div style={{fontSize:22,fontWeight:800,color:'#4ade80',lineHeight:1}}>{holdSecs}s</div>
              <div style={{fontSize:10,color:'#64748b',marginTop:2}}>hold / 5s</div>
            </div>
          )}
        </div>

        {/* Bottom */}
        <div style={{maxWidth:700,width:'100%',margin:'0 auto',padding:'12px 16px 28px',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:8,background:STATE.bg,border:`1px solid ${STATE.color}40`,borderRadius:10,padding:'10px 14px',transition:'all 0.3s ease'}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:STATE.color,boxShadow:matchState==='matched'?`0 0 10px ${STATE.color}`:'none',animation:matchState==='matched'?'pulse 1s ease infinite':'none',flexShrink:0}}/>
            <div style={{fontSize:13,fontWeight:600,color:STATE.color}}>{STATE.label}</div>
          </div>

          <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{fontSize:11,color:'#475569',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.06em'}}>Current cue</div>
            <div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.5}}>{exercise.cues[cueIdx]}</div>
          </div>

          <div style={{display:'flex',gap:16,padding:'4px 0',fontSize:11,color:'#475569'}}>
            {([['rgba(96,165,250,0.7)','Target pose'],['rgba(255,255,255,0.7)','Your body'],['rgba(74,222,128,0.8)','Matched \u2713']] as const).map(([bg,label])=>(
              <span key={label} style={{display:'flex',alignItems:'center',gap:5}}>
                <span style={{display:'inline-block',width:12,height:3,background:bg,borderRadius:2}}/>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin  { to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
      `}</style>
    </div>
  );
}
