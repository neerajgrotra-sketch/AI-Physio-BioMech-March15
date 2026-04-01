'use client';

// MediaPipe loaded via CDN script tags at runtime.
// NO @mediapipe npm imports -- those cause webpack build failures in Next.js 14.
import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window { Pose: any; Camera: any; }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ─── Landmark indices ─────────────────────────────────────────────────────────
const LP = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
  LEFT_KNEE: 25,     RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,    RIGHT_ANKLE: 28,
};

type Vec2 = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

// ─── Body measurements extracted from live landmarks ─────────────────────────
// All lengths in canvas pixels. Used to scale the ghost to the patient's body.
type BodyMeasure = {
  shoulderMid: Vec2;   // midpoint between shoulders
  hipMid: Vec2;        // midpoint between hips
  torsoLen: number;    // shoulder-mid to hip-mid distance
  shoulderWidth: number;
  rightUpperArm: number;
  rightForeArm: number;
  leftUpperArm: number;
  leftForeArm: number;
  rightThigh: number;
  rightShin: number;
  leftThigh: number;
  leftShin: number;
  // Unit vectors along spine (up = toward head)
  spineUp: Vec2;
  spineRight: Vec2;
};

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function norm(v: Vec2): Vec2 {
  const m = Math.sqrt(v.x ** 2 + v.y ** 2);
  return m === 0 ? { x: 0, y: -1 } : { x: v.x / m, y: v.y / m };
}

function lmToCanvas(lm: Landmark, w: number, h: number): Vec2 {
  return { x: lm.x * w, y: lm.y * h };
}

function visible(lm: Landmark | undefined): boolean {
  return !!lm && (lm.visibility ?? 1) > 0.25;
}

function measureBody(lms: Landmark[], w: number, h: number): BodyMeasure | null {
  const ls = lms[LP.LEFT_SHOULDER]; const rs = lms[LP.RIGHT_SHOULDER];
  const lh = lms[LP.LEFT_HIP];      const rh = lms[LP.RIGHT_HIP];
  if (!visible(ls) || !visible(rs) || !visible(lh) || !visible(rh)) return null;

  const lsC = lmToCanvas(ls, w, h); const rsC = lmToCanvas(rs, w, h);
  const lhC = lmToCanvas(lh, w, h); const rhC = lmToCanvas(rh, w, h);

  const shoulderMid: Vec2 = { x: (lsC.x + rsC.x) / 2, y: (lsC.y + rsC.y) / 2 };
  const hipMid: Vec2      = { x: (lhC.x + rhC.x) / 2, y: (lhC.y + rhC.y) / 2 };

  const spineVec = { x: shoulderMid.x - hipMid.x, y: shoulderMid.y - hipMid.y };
  const spineUp  = norm(spineVec);
  const spineRight: Vec2 = { x: -spineUp.y, y: spineUp.x };

  const torsoLen = dist(shoulderMid, hipMid);

  const getLen = (a: number, b: number): number => {
    if (!visible(lms[a]) || !visible(lms[b])) return torsoLen * 0.4;
    return dist(lmToCanvas(lms[a], w, h), lmToCanvas(lms[b], w, h));
  };

  return {
    shoulderMid, hipMid, torsoLen,
    shoulderWidth: dist(lsC, rsC),
    rightUpperArm: getLen(LP.RIGHT_SHOULDER, LP.RIGHT_ELBOW),
    rightForeArm:  getLen(LP.RIGHT_ELBOW, LP.RIGHT_WRIST),
    leftUpperArm:  getLen(LP.LEFT_SHOULDER, LP.LEFT_ELBOW),
    leftForeArm:   getLen(LP.LEFT_ELBOW, LP.LEFT_WRIST),
    rightThigh:    getLen(LP.RIGHT_HIP, LP.RIGHT_KNEE),
    rightShin:     getLen(LP.RIGHT_KNEE, LP.RIGHT_ANKLE),
    leftThigh:     getLen(LP.LEFT_HIP, LP.LEFT_KNEE),
    leftShin:      getLen(LP.LEFT_KNEE, LP.LEFT_ANKLE),
    spineUp, spineRight,
  };
}

// ─── Ghost pose definition ────────────────────────────────────────────────────
// Each pose is defined as a set of limb directions (angles in degrees, 0=up, CW+)
// The ghost is then *constructed* from the patient's own bone lengths, so it
// always fits their body regardless of camera crop or distance.
//
// Angle convention: 0deg = straight up (-Y), 90deg = right (+X), 180 = down, 270 = left
// All angles are in canvas space (Y increases downward).

type LimbAngle = {
  // Start landmark, end landmark, angle from vertical (canvas space), length source
  fromJoint: 'rightShoulder' | 'leftShoulder' | 'rightHip' | 'leftHip' | 'rightElbow' | 'leftElbow' | 'rightKnee' | 'leftKnee';
  toJoint: 'rightElbow' | 'leftElbow' | 'rightWrist' | 'leftWrist' | 'rightKnee' | 'leftKnee' | 'rightAnkle' | 'leftAnkle';
  angleDeg: number;      // angle of this limb from vertical (canvas Y-down), 0=up 90=right 180=down 270=left
  lengthKey: keyof BodyMeasure;
};

type GhostPose = {
  id: string;
  name: string;
  description: string;
  cues: string[];
  limbs: LimbAngle[];
  // Joint angle targets for match scoring
  matchJoints: {
    name: string;
    a: number; b: number; c: number;
    targetDeg: number; toleranceDeg: number; weight: number;
  }[];
};

// Helper: degrees to radians
const DEG = Math.PI / 180;

// ─── Exercise library ─────────────────────────────────────────────────────────
// Limb angles are in canvas space where Y increases downward.
// "Arm raised to 90deg abduction" means upper arm points horizontally to the right.
// Right side is patient's right, but mirrored on canvas so it appears as their right.

const EXERCISES: GhostPose[] = [
  {
    id: 'shoulder_abduction',
    name: 'Shoulder Abduction',
    description: 'Raise your right arm out to the side to shoulder height',
    cues: ['Stand tall, feet shoulder-width apart', 'Keep your elbow straight', 'Raise your arm out to the side', 'Stop when arm is level with shoulder'],
    limbs: [
      // Right arm: upper arm horizontal (90deg from vertical = pointing right in canvas after mirror)
      { fromJoint: 'rightShoulder', toJoint: 'rightElbow', angleDeg: 270, lengthKey: 'rightUpperArm' }, // 270 = left in canvas = patient's right after mirror
      { fromJoint: 'rightElbow',    toJoint: 'rightWrist', angleDeg: 270, lengthKey: 'rightForeArm'  },
      // Left arm: hanging down naturally
      { fromJoint: 'leftShoulder',  toJoint: 'leftElbow',  angleDeg: 160, lengthKey: 'leftUpperArm'  },
      { fromJoint: 'leftElbow',     toJoint: 'leftWrist',  angleDeg: 175, lengthKey: 'leftForeArm'   },
      // Legs: standing straight
      { fromJoint: 'rightHip',  toJoint: 'rightKnee',  angleDeg: 175, lengthKey: 'rightThigh' },
      { fromJoint: 'rightKnee', toJoint: 'rightAnkle', angleDeg: 178, lengthKey: 'rightShin'  },
      { fromJoint: 'leftHip',   toJoint: 'leftKnee',   angleDeg: 175, lengthKey: 'leftThigh'  },
      { fromJoint: 'leftKnee',  toJoint: 'leftAnkle',  angleDeg: 178, lengthKey: 'leftShin'   },
    ],
    matchJoints: [
      { name: 'shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW,  targetDeg: 90,  toleranceDeg: 18, weight: 0.7 },
      { name: 'elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 170, toleranceDeg: 18, weight: 0.3 },
    ],
  },
  {
    id: 'shoulder_external_rotation',
    name: 'Shoulder External Rotation',
    description: 'Elbow at side, rotate your forearm outward',
    cues: ['Keep your elbow tucked into your side', 'Start with forearm across your body', 'Rotate your forearm outward', 'Hold at maximum comfortable rotation'],
    limbs: [
      // Right upper arm: pointing straight down (elbow at side)
      { fromJoint: 'rightShoulder', toJoint: 'rightElbow', angleDeg: 175, lengthKey: 'rightUpperArm' },
      // Right forearm: pointing outward (horizontal, away from body — toward patient right = canvas left after mirror)
      { fromJoint: 'rightElbow',    toJoint: 'rightWrist', angleDeg: 270, lengthKey: 'rightForeArm'  },
      { fromJoint: 'leftShoulder',  toJoint: 'leftElbow',  angleDeg: 165, lengthKey: 'leftUpperArm'  },
      { fromJoint: 'leftElbow',     toJoint: 'leftWrist',  angleDeg: 175, lengthKey: 'leftForeArm'   },
      { fromJoint: 'rightHip',  toJoint: 'rightKnee',  angleDeg: 175, lengthKey: 'rightThigh' },
      { fromJoint: 'rightKnee', toJoint: 'rightAnkle', angleDeg: 178, lengthKey: 'rightShin'  },
      { fromJoint: 'leftHip',   toJoint: 'leftKnee',   angleDeg: 175, lengthKey: 'leftThigh'  },
      { fromJoint: 'leftKnee',  toJoint: 'leftAnkle',  angleDeg: 178, lengthKey: 'leftShin'   },
    ],
    matchJoints: [
      { name: 'elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 90, toleranceDeg: 15, weight: 0.5 },
      { name: 'shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW,   targetDeg: 15, toleranceDeg: 12, weight: 0.5 },
    ],
  },
  {
    id: 'knee_extension',
    name: 'Knee Extension',
    description: 'Seated — straighten your leg fully',
    cues: ['Sit upright in your chair', 'Tighten your quadriceps', 'Slowly straighten your knee', 'Hold with leg fully extended'],
    limbs: [
      { fromJoint: 'rightShoulder', toJoint: 'rightElbow', angleDeg: 165, lengthKey: 'rightUpperArm' },
      { fromJoint: 'rightElbow',    toJoint: 'rightWrist', angleDeg: 175, lengthKey: 'rightForeArm'  },
      { fromJoint: 'leftShoulder',  toJoint: 'leftElbow',  angleDeg: 165, lengthKey: 'leftUpperArm'  },
      { fromJoint: 'leftElbow',     toJoint: 'leftWrist',  angleDeg: 175, lengthKey: 'leftForeArm'   },
      // Right leg: extended horizontally forward (seated) — pointing right in canvas = patient left after mirror, so use 90
      { fromJoint: 'rightHip',  toJoint: 'rightKnee',  angleDeg: 90, lengthKey: 'rightThigh' },
      { fromJoint: 'rightKnee', toJoint: 'rightAnkle', angleDeg: 90, lengthKey: 'rightShin'  },
      // Left leg: bent at 90deg (seated natural)
      { fromJoint: 'leftHip',  toJoint: 'leftKnee',   angleDeg: 90,  lengthKey: 'leftThigh' },
      { fromJoint: 'leftKnee', toJoint: 'leftAnkle',  angleDeg: 175, lengthKey: 'leftShin'  },
    ],
    matchJoints: [
      { name: 'knee', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE,    targetDeg: 170, toleranceDeg: 12, weight: 0.8 },
      { name: 'hip',  a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE, targetDeg: 95,  toleranceDeg: 18, weight: 0.2 },
    ],
  },
  {
    id: 'knee_flexion',
    name: 'Knee Flexion',
    description: 'Standing — bend your knee to 90 degrees behind you',
    cues: ['Stand on your left leg', 'Hold a surface if needed for balance', 'Keep your thighs level', 'Bend right knee to 90 degrees behind you'],
    limbs: [
      { fromJoint: 'rightShoulder', toJoint: 'rightElbow', angleDeg: 165, lengthKey: 'rightUpperArm' },
      { fromJoint: 'rightElbow',    toJoint: 'rightWrist', angleDeg: 175, lengthKey: 'rightForeArm'  },
      { fromJoint: 'leftShoulder',  toJoint: 'leftElbow',  angleDeg: 165, lengthKey: 'leftUpperArm'  },
      { fromJoint: 'leftElbow',     toJoint: 'leftWrist',  angleDeg: 175, lengthKey: 'leftForeArm'   },
      // Right thigh: straight down, right knee: bent backward (shin points up behind)
      { fromJoint: 'rightHip',  toJoint: 'rightKnee',  angleDeg: 175, lengthKey: 'rightThigh' },
      { fromJoint: 'rightKnee', toJoint: 'rightAnkle', angleDeg: 5,   lengthKey: 'rightShin'  }, // shin pointing upward = 5deg from vertical
      // Left leg: straight standing
      { fromJoint: 'leftHip',   toJoint: 'leftKnee',   angleDeg: 175, lengthKey: 'leftThigh'  },
      { fromJoint: 'leftKnee',  toJoint: 'leftAnkle',  angleDeg: 178, lengthKey: 'leftShin'   },
    ],
    matchJoints: [
      { name: 'knee', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE,    targetDeg: 90,  toleranceDeg: 18, weight: 0.8 },
      { name: 'hip',  a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE, targetDeg: 175, toleranceDeg: 15, weight: 0.2 },
    ],
  },
];

// ─── Build ghost joint positions from body measurements + limb angles ─────────
// Returns a map of jointName -> canvas pixel position
type GhostJoints = {
  rightShoulder: Vec2; leftShoulder: Vec2;
  rightElbow: Vec2;    leftElbow: Vec2;
  rightWrist: Vec2;    leftWrist: Vec2;
  rightHip: Vec2;      leftHip: Vec2;
  rightKnee: Vec2;     leftKnee: Vec2;
  rightAnkle: Vec2;    leftAnkle: Vec2;
};

function buildGhostJoints(m: BodyMeasure, pose: GhostPose): GhostJoints {
  // Shoulder and hip positions taken directly from patient's live skeleton
  const hw = m.shoulderWidth / 2;
  const rightShoulder: Vec2 = {
    x: m.shoulderMid.x + m.spineRight.x * hw,
    y: m.shoulderMid.y + m.spineRight.y * hw,
  };
  const leftShoulder: Vec2 = {
    x: m.shoulderMid.x - m.spineRight.x * hw,
    y: m.shoulderMid.y - m.spineRight.y * hw,
  };
  const rhw = m.shoulderWidth * 0.42;
  const rightHip: Vec2 = {
    x: m.hipMid.x + m.spineRight.x * rhw,
    y: m.hipMid.y + m.spineRight.y * rhw,
  };
  const leftHip: Vec2 = {
    x: m.hipMid.x - m.spineRight.x * rhw,
    y: m.hipMid.y - m.spineRight.y * rhw,
  };

  const origins: Record<string, Vec2> = { rightShoulder, leftShoulder, rightHip, leftHip };
  const joints: Record<string, Vec2> = { rightShoulder, leftShoulder, rightHip, leftHip };

  // Walk each limb: compute end position from start + angle + length
  for (const limb of pose.limbs) {
    const origin = origins[limb.fromJoint];
    if (!origin) continue;
    const len = m[limb.lengthKey] as number;
    const rad = limb.angleDeg * DEG;
    const end: Vec2 = {
      x: origin.x + Math.sin(rad) * len,
      y: origin.y - Math.cos(rad) * len, // -cos because Y increases downward
    };
    joints[limb.toJoint] = end;
    origins[limb.toJoint] = end; // allow chaining (elbow -> wrist)
  }

  return {
    rightShoulder: joints.rightShoulder ?? rightShoulder,
    leftShoulder:  joints.leftShoulder  ?? leftShoulder,
    rightElbow:    joints.rightElbow    ?? rightShoulder,
    leftElbow:     joints.leftElbow     ?? leftShoulder,
    rightWrist:    joints.rightWrist    ?? rightShoulder,
    leftWrist:     joints.leftWrist     ?? leftShoulder,
    rightHip:      joints.rightHip      ?? rightHip,
    leftHip:       joints.leftHip       ?? leftHip,
    rightKnee:     joints.rightKnee     ?? rightHip,
    leftKnee:      joints.leftKnee      ?? leftHip,
    rightAnkle:    joints.rightAnkle    ?? rightHip,
    leftAnkle:     joints.leftAnkle     ?? leftHip,
  };
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function angleDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const mag = Math.sqrt(ba.x ** 2 + ba.y ** 2) * Math.sqrt(bc.x ** 2 + bc.y ** 2);
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function computeMatch(landmarks: Landmark[], pose: GhostPose): number {
  let totalW = 0; let scored = 0;
  for (const j of pose.matchJoints) {
    const a = landmarks[j.a]; const b = landmarks[j.b]; const c = landmarks[j.c];
    if (!a || !b || !c) continue;
    if (!visible(a) || !visible(b) || !visible(c)) continue;
    const delta = Math.abs(angleDeg(a, b, c) - j.targetDeg);
    scored += Math.max(0, 1 - delta / (j.toleranceDeg * 2)) * j.weight;
    totalW += j.weight;
  }
  return totalW > 0 ? scored / totalW : 0;
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────
const GHOST_CONNECTIONS: [keyof GhostJoints, keyof GhostJoints][] = [
  ['leftShoulder',  'rightShoulder'],
  ['rightShoulder', 'rightElbow'],  ['rightElbow', 'rightWrist'],
  ['leftShoulder',  'leftElbow'],   ['leftElbow',  'leftWrist'],
  ['rightShoulder', 'rightHip'],    ['leftShoulder', 'leftHip'],
  ['rightHip',      'leftHip'],
  ['rightHip',  'rightKnee'],  ['rightKnee', 'rightAnkle'],
  ['leftHip',   'leftKnee'],   ['leftKnee',  'leftAnkle'],
];

const LIVE_CONNECTIONS: [number, number][] = [
  [LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER],
  [LP.RIGHT_SHOULDER, LP.RIGHT_ELBOW], [LP.RIGHT_ELBOW, LP.RIGHT_WRIST],
  [LP.LEFT_SHOULDER,  LP.LEFT_ELBOW],  [LP.LEFT_ELBOW,  LP.LEFT_WRIST],
  [LP.RIGHT_SHOULDER, LP.RIGHT_HIP],   [LP.LEFT_SHOULDER, LP.LEFT_HIP],
  [LP.LEFT_HIP, LP.RIGHT_HIP],
  [LP.RIGHT_HIP, LP.RIGHT_KNEE], [LP.RIGHT_KNEE, LP.RIGHT_ANKLE],
  [LP.LEFT_HIP,  LP.LEFT_KNEE],  [LP.LEFT_KNEE,  LP.LEFT_ANKLE],
];

function drawGhost(ctx: CanvasRenderingContext2D, joints: GhostJoints, score: number) {
  const g = Math.floor(score * 255);
  const b = Math.floor((1 - score) * 220);
  const lineAlpha = 0.55;
  const jointAlpha = 0.70;

  // Torso fill
  const torso = [joints.leftShoulder, joints.rightShoulder, joints.rightHip, joints.leftHip];
  ctx.beginPath();
  ctx.moveTo(torso[0].x, torso[0].y);
  torso.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = `rgba(${g},${Math.floor(g * 0.2)},${b},0.07)`;
  ctx.fill();

  // Ghost skeleton
  ctx.setLineDash([8, 5]);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const [a, b2] of GHOST_CONNECTIONS) {
    const pA = joints[a]; const pB = joints[b2];
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y);
    ctx.strokeStyle = `rgba(${g},${Math.floor(g * 0.4)},${b},${lineAlpha})`;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Ghost joint dots
  (Object.values(joints) as Vec2[]).forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${g},${Math.floor(g * 0.4)},${b},${jointAlpha})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5; ctx.stroke();
  });
}

function drawLive(ctx: CanvasRenderingContext2D, lms: Landmark[], w: number, h: number, score: number) {
  const matched = score >= 0.85;
  const col = matched ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.90)';
  const toC = (lm: Landmark): Vec2 => ({ x: lm.x * w, y: lm.y * h });

  ctx.setLineDash([]); ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  for (const [a, b] of LIVE_CONNECTIONS) {
    const lA = lms[a]; const lB = lms[b];
    if (!visible(lA) || !visible(lB)) continue;
    const pA = toC(lA); const pB = toC(lB);
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y);
    ctx.strokeStyle = col; ctx.stroke();
  }
  [LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER, LP.LEFT_ELBOW, LP.RIGHT_ELBOW,
   LP.LEFT_WRIST, LP.RIGHT_WRIST, LP.LEFT_HIP, LP.RIGHT_HIP,
   LP.LEFT_KNEE, LP.RIGHT_KNEE, LP.LEFT_ANKLE, LP.RIGHT_ANKLE].forEach(i => {
    const lm = lms[i]; if (!visible(lm)) return;
    const p = toC(lm);
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PoseDemoRunner() {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef<number>(0);
  const landmarksRef = useRef<Landmark[]>([]);
  const exerciseRef  = useRef<GhostPose>(EXERCISES[0]);

  const [exercise, setExercise]         = useState<GhostPose>(EXERCISES[0]);
  const [score, setScore]               = useState(0);
  const [matchState, setMatchState]     = useState<'idle'|'tracking'|'close'|'matched'>('idle');
  const [holdSecs, setHoldSecs]         = useState(0);
  const [reps, setReps]                 = useState(0);
  const [cameraReady, setCameraReady]   = useState(false);
  const [cameraError, setCameraError]   = useState('');
  const [loading, setLoading]           = useState(true);
  const [cueIdx, setCueIdx]             = useState(0);
  const [showMenu, setShowMenu]         = useState(false);

  const holdRef      = useRef(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { exerciseRef.current = exercise; }, [exercise]);

  // Cue rotation
  useEffect(() => {
    const id = setInterval(() => setCueIdx(i => (i + 1) % exercise.cues.length), 4000);
    return () => clearInterval(id);
  }, [exercise]);

  // Hold timer
  useEffect(() => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdRef.current = 0; setHoldSecs(0);
    if (matchState === 'matched') {
      holdTimerRef.current = setInterval(() => {
        holdRef.current += 1; setHoldSecs(holdRef.current);
        if (holdRef.current >= 5) { setReps(r => r + 1); holdRef.current = 0; setHoldSecs(0); }
      }, 1000);
    }
    return () => { if (holdTimerRef.current) clearInterval(holdTimerRef.current); };
  }, [matchState]);

  const renderLoop = useCallback(() => {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas) { animRef.current = requestAnimationFrame(renderLoop); return; }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const w = canvas.width; const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    // Mirror video horizontally so it feels like a mirror
    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -w, 0, w, h); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.fillRect(0, 0, w, h);

    const lms = landmarksRef.current;
    if (lms.length > 0) {
      // Mirror landmarks to match mirrored video
      const mirrored = lms.map(lm => ({ ...lm, x: 1 - lm.x }));

      // Compute match score from raw (unmirrored) landmarks
      const s = computeMatch(lms, exerciseRef.current);
      setScore(s);
      setMatchState(s >= 0.85 ? 'matched' : s >= 0.55 ? 'close' : 'tracking');

      // Build ghost from mirrored landmarks (so it aligns with mirrored video)
      const measure = measureBody(mirrored, w, h);
      if (measure) {
        const ghostJoints = buildGhostJoints(measure, exerciseRef.current);
        drawGhost(ctx, ghostJoints, s);
      }
      drawLive(ctx, mirrored, w, h, s);
    }
    animRef.current = requestAnimationFrame(renderLoop);
  }, []);

  // Init camera + MediaPipe
  useEffect(() => {
    let stopped = false;
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setCameraReady(true);

        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
        if (stopped) return;

        const pose = new window.Pose({ locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
        pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        pose.onResults((r: any) => { if (r.poseLandmarks) landmarksRef.current = r.poseLandmarks; });
        setLoading(false);

        const camera = new window.Camera(videoRef.current!, {
          onFrame: async () => { await pose.send({ image: videoRef.current! }); },
          width: 640, height: 480,
        });
        camera.start();
        animRef.current = requestAnimationFrame(renderLoop);
      } catch (e: any) {
        setCameraError(e?.message ?? 'Camera access denied');
        setLoading(false);
      }
    };
    init();
    return () => {
      stopped = true;
      cancelAnimationFrame(animRef.current);
      if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    };
  }, [renderLoop]);

  const pct = Math.round(score * 100);
  const STATE = {
    idle:     { label: 'Position yourself in frame',       color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    tracking: { label: 'Match the silhouette',             color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
    close:    { label: 'Almost there \u2014 keep going',   color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
    matched:  { label: `Hold \u2014 ${holdSecs}s / 5s`,   color: '#4ade80', bg: 'rgba(74,222,128,0.12)'  },
  }[matchState];

  const selectExercise = (ex: GhostPose) => {
    setExercise(ex); setShowMenu(false); setReps(0); setScore(0); setMatchState('idle'); setCueIdx(0);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#080c14', fontFamily: "'DM Sans','SF Pro Display',system-ui,sans-serif", display: 'flex', flexDirection: 'column', color: '#f1f5f9' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,12,20,0.95)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#3b82f6,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>&#x2b21;</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>Rehably</div>
            <div style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Movement Guide</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ padding: '4px 12px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', fontSize: 13, fontWeight: 600, color: '#60a5fa' }}>
            {reps} rep{reps !== 1 ? 's' : ''}
          </div>
          <button onClick={() => setShowMenu(m => !m)} style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            {exercise.name} &#9662;
          </button>
        </div>
      </div>

      {/* Exercise menu */}
      {showMenu && (
        <div style={{ position: 'fixed', top: 62, right: 16, zIndex: 100, background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', minWidth: 240 }}>
          {EXERCISES.map(ex => (
            <button key={ex.id} onClick={() => selectExercise(ex)} style={{ width: '100%', display: 'block', padding: '12px 16px', textAlign: 'left', background: ex.id === exercise.id ? 'rgba(59,130,246,0.15)' : 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', color: ex.id === exercise.id ? '#60a5fa' : '#94a3b8', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              {ex.name}
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{ex.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Camera */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 700, margin: '0 auto', aspectRatio: '4/3' }}>
          <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
          <canvas ref={canvasRef} width={640} height={480} style={{ width: '100%', height: '100%', borderRadius: 16, display: 'block', background: '#0a0f1e' }} />

          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,20,0.85)', borderRadius: 16, gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid rgba(96,165,250,0.2)', borderTop: '3px solid #60a5fa', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ fontSize: 13, color: '#64748b' }}>{cameraReady ? 'Loading pose detection\u2026' : 'Requesting camera\u2026'}</div>
            </div>
          )}

          {cameraError && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,20,0.92)', borderRadius: 16, gap: 8, padding: 24 }}>
              <div style={{ fontSize: 32 }}>&#128247;</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>Camera access needed</div>
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>{cameraError}</div>
            </div>
          )}

          {/* Score badge */}
          {!loading && !cameraError && (
            <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(8,12,20,0.78)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 12px', border: `1px solid ${STATE.color}40`, minWidth: 80 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: STATE.color, lineHeight: 1 }}>{pct}%</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>match</div>
              <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: STATE.color, borderRadius: 2, transition: 'width 0.2s ease, background 0.3s ease' }} />
              </div>
            </div>
          )}

          {/* Hold badge */}
          {matchState === 'matched' && (
            <div style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#4ade80', lineHeight: 1 }}>{holdSecs}s</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>hold / 5s</div>
            </div>
          )}
        </div>

        {/* Bottom panel */}
        <div style={{ maxWidth: 700, width: '100%', margin: '0 auto', padding: '12px 16px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: STATE.bg, border: `1px solid ${STATE.color}40`, borderRadius: 10, padding: '10px 14px', transition: 'all 0.3s ease' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATE.color, boxShadow: matchState === 'matched' ? `0 0 10px ${STATE.color}` : 'none', animation: matchState === 'matched' ? 'pulse 1s ease infinite' : 'none', flexShrink: 0 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: STATE.color }}>{STATE.label}</div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current cue</div>
            <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{exercise.cues[cueIdx]}</div>
          </div>

          <div style={{ display: 'flex', gap: 16, padding: '4px 0', fontSize: 11, color: '#475569' }}>
            {([['rgba(96,165,250,0.6)', 'Target pose'], ['rgba(255,255,255,0.7)', 'Your body'], ['rgba(74,222,128,0.8)', 'Matched \u2713']] as const).map(([bg, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 12, height: 3, background: bg, borderRadius: 2 }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </div>
  );
}
