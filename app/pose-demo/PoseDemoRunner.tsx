'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── BlazePose landmark indices ───────────────────────────────────────────────
const LP = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
  LEFT_KNEE: 25,     RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,    RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,     RIGHT_HEEL: 30,
  LEFT_FOOT: 31,     RIGHT_FOOT: 32,
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Vec2 = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

type JointTarget = {
  name: string;
  a: number; // landmark index - start of angle
  b: number; // landmark index - vertex
  c: number; // landmark index - end of angle
  targetDeg: number;
  toleranceDeg: number;
  weight: number;
};

type ExercisePose = {
  id: string;
  name: string;
  description: string;
  side: 'right' | 'left' | 'bilateral';
  cues: string[];
  joints: JointTarget[];
  // Normalised target landmark offsets from hip midpoint (0-1 space)
  targetOffsets: Partial<Record<number, Vec2>>;
};

// ─── Pose Library ─────────────────────────────────────────────────────────────
const POSE_LIBRARY: ExercisePose[] = [
  {
    id: 'shoulder_abduction',
    name: 'Shoulder Abduction',
    description: 'Raise your arm out to the side to shoulder height',
    side: 'right',
    cues: ['Stand tall, feet shoulder-width apart', 'Keep your elbow straight', 'Raise your arm out to the side', 'Stop when your arm is level with your shoulder'],
    joints: [
      { name: 'Right shoulder abduction', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW, targetDeg: 90, toleranceDeg: 15, weight: 0.7 },
      { name: 'Right elbow extension', a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 170, toleranceDeg: 15, weight: 0.3 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x: 0.18, y: -0.25 },
      [LP.RIGHT_ELBOW]:    { x: 0.38, y: -0.25 },
      [LP.RIGHT_WRIST]:    { x: 0.55, y: -0.25 },
      [LP.LEFT_SHOULDER]:  { x: -0.18, y: -0.25 },
      [LP.LEFT_ELBOW]:     { x: -0.18, y: -0.05 },
      [LP.LEFT_WRIST]:     { x: -0.18, y: 0.12 },
      [LP.RIGHT_HIP]:      { x: 0.12, y: 0 },
      [LP.LEFT_HIP]:       { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]:     { x: 0.13, y: 0.3 },
      [LP.LEFT_KNEE]:      { x: -0.13, y: 0.3 },
      [LP.RIGHT_ANKLE]:    { x: 0.13, y: 0.6 },
      [LP.LEFT_ANKLE]:     { x: -0.13, y: 0.6 },
    },
  },
  {
    id: 'shoulder_external_rotation',
    name: 'Shoulder External Rotation',
    description: 'Elbow at your side, rotate your forearm outward',
    side: 'right',
    cues: ['Keep your elbow tucked into your side', 'Start with forearm across your body', 'Rotate your forearm outward slowly', 'Hold at maximum comfortable rotation'],
    joints: [
      { name: 'Right elbow flexion', a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 90, toleranceDeg: 12, weight: 0.5 },
      { name: 'Right shoulder position', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW, targetDeg: 15, toleranceDeg: 10, weight: 0.5 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x: 0.18, y: -0.25 },
      [LP.RIGHT_ELBOW]:    { x: 0.18, y: -0.08 },
      [LP.RIGHT_WRIST]:    { x: 0.38, y: -0.08 },
      [LP.LEFT_SHOULDER]:  { x: -0.18, y: -0.25 },
      [LP.LEFT_ELBOW]:     { x: -0.18, y: -0.05 },
      [LP.LEFT_WRIST]:     { x: -0.18, y: 0.12 },
      [LP.RIGHT_HIP]:      { x: 0.12, y: 0 },
      [LP.LEFT_HIP]:       { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]:     { x: 0.13, y: 0.3 },
      [LP.LEFT_KNEE]:      { x: -0.13, y: 0.3 },
      [LP.RIGHT_ANKLE]:    { x: 0.13, y: 0.6 },
      [LP.LEFT_ANKLE]:     { x: -0.13, y: 0.6 },
    },
  },
  {
    id: 'knee_extension',
    name: 'Knee Extension',
    description: 'Seated — straighten your leg fully',
    side: 'right',
    cues: ['Sit upright in your chair', 'Tighten your quadriceps', 'Slowly straighten your knee', 'Hold with leg fully extended'],
    joints: [
      { name: 'Right knee extension', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE, targetDeg: 170, toleranceDeg: 10, weight: 0.8 },
      { name: 'Right hip angle (seated)', a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE, targetDeg: 95, toleranceDeg: 15, weight: 0.2 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x: 0.18, y: -0.42 },
      [LP.LEFT_SHOULDER]:  { x: -0.18, y: -0.42 },
      [LP.RIGHT_ELBOW]:    { x: 0.18, y: -0.22 },
      [LP.LEFT_ELBOW]:     { x: -0.18, y: -0.22 },
      [LP.RIGHT_WRIST]:    { x: 0.18, y: -0.05 },
      [LP.LEFT_WRIST]:     { x: -0.18, y: -0.05 },
      [LP.RIGHT_HIP]:      { x: 0.12, y: 0 },
      [LP.LEFT_HIP]:       { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]:     { x: 0.38, y: 0.02 },
      [LP.LEFT_KNEE]:      { x: -0.13, y: 0.28 },
      [LP.RIGHT_ANKLE]:    { x: 0.62, y: 0.04 },
      [LP.LEFT_ANKLE]:     { x: -0.13, y: 0.52 },
    },
  },
  {
    id: 'knee_flexion',
    name: 'Knee Flexion',
    description: 'Standing — bend your knee to 90 degrees behind you',
    side: 'right',
    cues: ['Stand on your left leg, hold a surface if needed', 'Keep your thighs level', 'Slowly bend your right knee', 'Hold when heel is level with your knee'],
    joints: [
      { name: 'Right knee flexion', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE, targetDeg: 90, toleranceDeg: 15, weight: 0.8 },
      { name: 'Hip alignment', a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE, targetDeg: 175, toleranceDeg: 12, weight: 0.2 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x: 0.18, y: -0.42 },
      [LP.LEFT_SHOULDER]:  { x: -0.18, y: -0.42 },
      [LP.RIGHT_ELBOW]:    { x: 0.18, y: -0.22 },
      [LP.LEFT_ELBOW]:     { x: -0.18, y: -0.22 },
      [LP.RIGHT_WRIST]:    { x: 0.18, y: -0.05 },
      [LP.LEFT_WRIST]:     { x: -0.18, y: -0.05 },
      [LP.RIGHT_HIP]:      { x: 0.12, y: 0 },
      [LP.LEFT_HIP]:       { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]:     { x: 0.12, y: 0.28 },
      [LP.LEFT_KNEE]:      { x: -0.13, y: 0.3 },
      [LP.RIGHT_ANKLE]:    { x: 0.28, y: 0.12 },
      [LP.LEFT_ANKLE]:     { x: -0.13, y: 0.6 },
    },
  },
];

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function angleDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const mag = Math.sqrt(ba.x ** 2 + ba.y ** 2) * Math.sqrt(bc.x ** 2 + bc.y ** 2);
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function computeMatchScore(landmarks: Landmark[], pose: ExercisePose): { score: number; jointScores: Record<string, number> } {
  let totalWeight = 0;
  let weightedScore = 0;
  const jointScores: Record<string, number> = {};

  for (const joint of pose.joints) {
    const a = landmarks[joint.a];
    const b = landmarks[joint.b];
    const c = landmarks[joint.c];
    if (!a || !b || !c) continue;
    if ((a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3 || (c.visibility ?? 1) < 0.3) continue;

    const measured = angleDeg(a, b, c);
    const delta = Math.abs(measured - joint.targetDeg);
    const score = Math.max(0, 1 - delta / (joint.toleranceDeg * 2));
    jointScores[joint.name] = score;
    weightedScore += score * joint.weight;
    totalWeight += joint.weight;
  }

  return {
    score: totalWeight > 0 ? weightedScore / totalWeight : 0,
    jointScores,
  };
}

// ─── Canvas Renderer ──────────────────────────────────────────────────────────
const BODY_CONNECTIONS: [number, number][] = [
  [LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER],
  [LP.LEFT_SHOULDER, LP.LEFT_ELBOW],   [LP.LEFT_ELBOW, LP.LEFT_WRIST],
  [LP.RIGHT_SHOULDER, LP.RIGHT_ELBOW], [LP.RIGHT_ELBOW, LP.RIGHT_WRIST],
  [LP.LEFT_SHOULDER, LP.LEFT_HIP],     [LP.RIGHT_SHOULDER, LP.RIGHT_HIP],
  [LP.LEFT_HIP, LP.RIGHT_HIP],
  [LP.LEFT_HIP, LP.LEFT_KNEE],         [LP.LEFT_KNEE, LP.LEFT_ANKLE],
  [LP.RIGHT_HIP, LP.RIGHT_KNEE],       [LP.RIGHT_KNEE, LP.RIGHT_ANKLE],
];

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  targetOffsets: Partial<Record<number, Vec2>>,
  anchor: Vec2,
  scale: number,
  matchScore: number,
  w: number,
  h: number
) {
  const green = Math.floor(matchScore * 255);
  const blue = Math.floor((1 - matchScore) * 255);
  const alpha = 0.45;

  const getPos = (idx: number): Vec2 | null => {
    const offset = targetOffsets[idx];
    if (!offset) return null;
    return {
      x: anchor.x + offset.x * scale,
      y: anchor.y + offset.y * scale,
    };
  };

  // Draw ghost body fill (convex-ish outline for torso)
  const torsoPoints = [
    targetOffsets[LP.LEFT_SHOULDER],
    targetOffsets[LP.RIGHT_SHOULDER],
    targetOffsets[LP.RIGHT_HIP],
    targetOffsets[LP.LEFT_HIP],
  ].filter(Boolean) as Vec2[];

  if (torsoPoints.length === 4) {
    ctx.beginPath();
    ctx.moveTo(anchor.x + torsoPoints[0].x * scale, anchor.y + torsoPoints[0].y * scale);
    for (let i = 1; i < torsoPoints.length; i++) {
      ctx.lineTo(anchor.x + torsoPoints[i].x * scale, anchor.y + torsoPoints[i].y * scale);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${green}, ${Math.floor(green * 0.4)}, ${blue}, 0.08)`;
    ctx.fill();
  }

  // Draw ghost skeleton connections
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.setLineDash([8, 5]);

  for (const [a, b] of BODY_CONNECTIONS) {
    const posA = getPos(a);
    const posB = getPos(b);
    if (!posA || !posB) continue;
    ctx.beginPath();
    ctx.moveTo(posA.x, posA.y);
    ctx.lineTo(posB.x, posB.y);
    ctx.strokeStyle = `rgba(${green}, ${Math.floor(green * 0.6)}, ${blue}, ${alpha})`;
    ctx.stroke();
  }

  ctx.setLineDash([]);

  // Draw ghost joints
  const jointIndices = Object.keys(targetOffsets).map(Number);
  for (const idx of jointIndices) {
    const pos = getPos(idx);
    if (!pos) continue;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${green}, ${Math.floor(green * 0.6)}, ${blue}, ${alpha + 0.2})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,0.3)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawLivePose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  w: number,
  h: number,
  matchScore: number
) {
  const toCanvas = (lm: Landmark): Vec2 => ({ x: lm.x * w, y: lm.y * h });

  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.setLineDash([]);

  for (const [a, b] of BODY_CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    if (!lmA || !lmB) continue;
    if ((lmA.visibility ?? 1) < 0.2 || (lmB.visibility ?? 1) < 0.2) continue;
    const pA = toCanvas(lmA);
    const pB = toCanvas(lmB);
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.strokeStyle = matchScore >= 0.85 ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }

  const keyJoints = [
    LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER,
    LP.LEFT_ELBOW, LP.RIGHT_ELBOW,
    LP.LEFT_WRIST, LP.RIGHT_WRIST,
    LP.LEFT_HIP, LP.RIGHT_HIP,
    LP.LEFT_KNEE, LP.RIGHT_KNEE,
    LP.LEFT_ANKLE, LP.RIGHT_ANKLE,
  ];

  for (const idx of keyJoints) {
    const lm = landmarks[idx];
    if (!lm || (lm.visibility ?? 1) < 0.2) continue;
    const p = toCanvas(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = matchScore >= 0.85 ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.95)';
    ctx.fill();
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PoseDemoRunner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const poseRef = useRef<any>(null);
  const landmarksRef = useRef<Landmark[]>([]);

  const [selectedExercise, setSelectedExercise] = useState<ExercisePose>(POSE_LIBRARY[0]);
  const [matchScore, setMatchScore] = useState(0);
  const [matchState, setMatchState] = useState<'idle' | 'tracking' | 'close' | 'matched'>('idle');
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [reps, setReps] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentCueIdx, setCurrentCueIdx] = useState(0);
  const [showSelector, setShowSelector] = useState(false);

  const holdRef = useRef(0);
  const wasMatchedRef = useRef(false);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cue rotation
  useEffect(() => {
    const id = setInterval(() => {
      setCurrentCueIdx(i => (i + 1) % selectedExercise.cues.length);
    }, 4000);
    return () => clearInterval(id);
  }, [selectedExercise]);

  // Hold timer
  useEffect(() => {
    if (matchState === 'matched') {
      holdIntervalRef.current = setInterval(() => {
        holdRef.current += 1;
        setHoldSeconds(holdRef.current);
        if (holdRef.current >= 5) {
          setReps(r => r + 1);
          holdRef.current = 0;
          setHoldSeconds(0);
        }
      }, 1000);
    } else {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      holdRef.current = 0;
      setHoldSeconds(0);
    }
    return () => { if (holdIntervalRef.current) clearInterval(holdIntervalRef.current); };
  }, [matchState]);

  const renderLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !poseRef.current) {
      animRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Mirror video
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();

    // Dim overlay
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, h);

    const landmarks = landmarksRef.current;
    if (landmarks.length > 0) {
      // Mirror landmarks for display
      const mirrored = landmarks.map(lm => ({ ...lm, x: 1 - lm.x }));

      // Compute match
      const { score } = computeMatchScore(landmarks, selectedExercise);
      const smoothed = score;
      setMatchScore(smoothed);

      if (smoothed >= 0.85) {
        setMatchState('matched');
        wasMatchedRef.current = true;
      } else if (smoothed >= 0.55) {
        setMatchState('close');
        wasMatchedRef.current = false;
      } else {
        setMatchState('tracking');
        wasMatchedRef.current = false;
      }

      // Anchor at hip midpoint
      const lHip = mirrored[LP.LEFT_HIP];
      const rHip = mirrored[LP.RIGHT_HIP];
      const anchor: Vec2 = lHip && rHip
        ? { x: ((lHip.x + rHip.x) / 2) * w, y: ((lHip.y + rHip.y) / 2) * h }
        : { x: w / 2, y: h * 0.55 };

      const scale = Math.min(w, h) * 0.72;

      // Draw ghost silhouette
      drawSilhouette(ctx, selectedExercise.targetOffsets, anchor, scale, smoothed, w, h);

      // Draw live pose on top
      drawLivePose(ctx, mirrored, w, h, smoothed);

      // Match glow
      if (smoothed >= 0.85) {
        ctx.shadowColor = 'rgba(74,222,128,0.6)';
        ctx.shadowBlur = 30;
        ctx.shadowBlur = 0;
      }
    }

    animRef.current = requestAnimationFrame(renderLoop);
  }, [selectedExercise]);

  useEffect(() => {
    let stopped = false;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);

        // Load MediaPipe
        const { Pose } = await import('@mediapipe/pose' as any);
        const { Camera } = await import('@mediapipe/camera_utils' as any);

        const pose = new Pose({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
        });

        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        pose.onResults((results: any) => {
          if (results.poseLandmarks) {
            landmarksRef.current = results.poseLandmarks;
          }
        });

        poseRef.current = pose;
        setLoading(false);

        const camera = new Camera(videoRef.current!, {
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
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(renderLoop);
  }, [selectedExercise, renderLoop]);

  const scorePercent = Math.round(matchScore * 100);

  const stateConfig = {
    idle:     { label: 'Position yourself in frame',  color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
    tracking: { label: 'Match the blue silhouette',   color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
    close:    { label: 'Almost there — keep going',   color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
    matched:  { label: `Hold — ${holdSeconds}s / 5s`, color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  }[matchState];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080c14',
      fontFamily: "'DM Sans', 'SF Pro Display', system-ui, sans-serif",
      display: 'flex',
      flexDirection: 'column',
      color: '#f1f5f9',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(8,12,20,0.95)',
        backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>⬡</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>Rehably</div>
            <div style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Movement Guide</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Rep counter */}
          <div style={{
            padding: '4px 12px',
            borderRadius: 20,
            background: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(59,130,246,0.25)',
            fontSize: 13, fontWeight: 600, color: '#60a5fa',
          }}>
            {reps} rep{reps !== 1 ? 's' : ''}
          </div>

          {/* Exercise selector button */}
          <button
            onClick={() => setShowSelector(!showSelector)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#cbd5e1',
              fontSize: 12, fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {selectedExercise.name} ▾
          </button>
        </div>
      </div>

      {/* Exercise selector dropdown */}
      {showSelector && (
        <div style={{
          position: 'fixed', top: 62, right: 16, zIndex: 100,
          background: '#0f172a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          minWidth: 240,
        }}>
          {POSE_LIBRARY.map(ex => (
            <button
              key={ex.id}
              onClick={() => { setSelectedExercise(ex); setShowSelector(false); setReps(0); setMatchScore(0); setMatchState('idle'); }}
              style={{
                width: '100%', display: 'block', padding: '12px 16px',
                textAlign: 'left', background: ex.id === selectedExercise.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                border: 'none', color: ex.id === selectedExercise.id ? '#60a5fa' : '#94a3b8',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              {ex.name}
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{ex.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Camera area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          position: 'relative',
          width: '100%',
          maxWidth: 700,
          margin: '0 auto',
          aspectRatio: '4/3',
        }}>
          <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            style={{
              width: '100%', height: '100%',
              borderRadius: 16,
              display: 'block',
              background: '#0a0f1e',
            }}
          />

          {/* Loading overlay */}
          {loading && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(8,12,20,0.85)',
              borderRadius: 16, gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                border: '3px solid rgba(96,165,250,0.2)',
                borderTop: '3px solid #60a5fa',
                animation: 'spin 0.8s linear infinite',
              }} />
              <div style={{ fontSize: 13, color: '#64748b' }}>
                {cameraReady ? 'Loading pose detection…' : 'Requesting camera…'}
              </div>
            </div>
          )}

          {/* Camera error */}
          {cameraError && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(8,12,20,0.92)',
              borderRadius: 16, gap: 8, padding: 24,
            }}>
              <div style={{ fontSize: 32 }}>📷</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>Camera access needed</div>
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>{cameraError}</div>
            </div>
          )}

          {/* Match score arc — top left */}
          {!loading && !cameraError && (
            <div style={{
              position: 'absolute', top: 14, left: 14,
              background: 'rgba(8,12,20,0.75)',
              backdropFilter: 'blur(8px)',
              borderRadius: 10,
              padding: '8px 12px',
              border: `1px solid ${stateConfig.color}40`,
              minWidth: 80,
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: stateConfig.color, lineHeight: 1 }}>
                {scorePercent}%
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>match</div>

              {/* Score bar */}
              <div style={{
                marginTop: 6, height: 3, borderRadius: 2,
                background: 'rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${scorePercent}%`,
                  background: stateConfig.color,
                  borderRadius: 2,
                  transition: 'width 0.2s ease, background 0.3s ease',
                }} />
              </div>
            </div>
          )}

          {/* Hold ring — top right, when matched */}
          {matchState === 'matched' && (
            <div style={{
              position: 'absolute', top: 14, right: 14,
              background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.4)',
              borderRadius: 10,
              padding: '8px 12px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#4ade80', lineHeight: 1 }}>
                {holdSeconds}s
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>hold / 5s</div>
            </div>
          )}
        </div>

        {/* Bottom panel */}
        <div style={{
          maxWidth: 700, width: '100%', margin: '0 auto',
          padding: '12px 16px 24px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* Status pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: stateConfig.bg,
            border: `1px solid ${stateConfig.color}40`,
            borderRadius: 10, padding: '10px 14px',
            transition: 'all 0.3s ease',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: stateConfig.color,
              boxShadow: matchState === 'matched' ? `0 0 10px ${stateConfig.color}` : 'none',
              animation: matchState === 'matched' ? 'pulse 1s ease infinite' : 'none',
            }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: stateConfig.color }}>
              {stateConfig.label}
            </div>
          </div>

          {/* Exercise info */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Current cue
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
              {selectedExercise.cues[currentCueIdx]}
            </div>
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex', gap: 16, padding: '6px 0',
            fontSize: 11, color: '#475569',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 12, height: 3, background: 'rgba(96,165,250,0.6)', borderRadius: 2 }} />
              Target pose
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 12, height: 3, background: 'rgba(255,255,255,0.7)', borderRadius: 2 }} />
              Your body
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 12, height: 3, background: 'rgba(74,222,128,0.8)', borderRadius: 2 }} />
              Matched ✓
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </div>
  );
}
