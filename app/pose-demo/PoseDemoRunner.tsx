'use client';

// MediaPipe loaded via CDN script tags at runtime.
// NO @mediapipe npm imports -- those cause webpack build failures in Next.js 14.
import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    Pose: any;
    Camera: any;
  }
}

// ─── CDN loader helper ────────────────────────────────────────────────────────
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ─── BlazePose landmark indices ───────────────────────────────────────────────
const LP = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
  LEFT_KNEE: 25,     RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,    RIGHT_ANKLE: 28,
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Vec2 = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };

type JointTarget = {
  name: string;
  a: number; b: number; c: number;
  targetDeg: number; toleranceDeg: number; weight: number;
};

type ExercisePose = {
  id: string; name: string; description: string; cues: string[];
  joints: JointTarget[];
  targetOffsets: Partial<Record<number, Vec2>>;
};

// ─── Pose Library ─────────────────────────────────────────────────────────────
const POSE_LIBRARY: ExercisePose[] = [
  {
    id: 'shoulder_abduction', name: 'Shoulder Abduction',
    description: 'Raise your arm out to the side to shoulder height',
    cues: ['Stand tall, feet shoulder-width apart', 'Keep your elbow straight', 'Raise your arm out to the side', 'Stop when arm is level with your shoulder'],
    joints: [
      { name: 'shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW, targetDeg: 90,  toleranceDeg: 15, weight: 0.7 },
      { name: 'elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 170, toleranceDeg: 15, weight: 0.3 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x:  0.18, y: -0.25 }, [LP.RIGHT_ELBOW]: { x: 0.38, y: -0.25 }, [LP.RIGHT_WRIST]: { x: 0.55, y: -0.25 },
      [LP.LEFT_SHOULDER]:  { x: -0.18, y: -0.25 }, [LP.LEFT_ELBOW]:  { x: -0.18, y: -0.05 }, [LP.LEFT_WRIST]: { x: -0.18, y: 0.12 },
      [LP.RIGHT_HIP]: { x: 0.12, y: 0 }, [LP.LEFT_HIP]: { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]: { x: 0.13, y: 0.30 }, [LP.LEFT_KNEE]: { x: -0.13, y: 0.30 },
      [LP.RIGHT_ANKLE]: { x: 0.13, y: 0.60 }, [LP.LEFT_ANKLE]: { x: -0.13, y: 0.60 },
    },
  },
  {
    id: 'shoulder_external_rotation', name: 'Shoulder External Rotation',
    description: 'Elbow at your side, rotate your forearm outward',
    cues: ['Keep your elbow tucked into your side', 'Start with forearm across your body', 'Rotate your forearm outward slowly', 'Hold at maximum comfortable rotation'],
    joints: [
      { name: 'elbow',    a: LP.RIGHT_SHOULDER, b: LP.RIGHT_ELBOW, c: LP.RIGHT_WRIST, targetDeg: 90, toleranceDeg: 12, weight: 0.5 },
      { name: 'shoulder', a: LP.RIGHT_HIP, b: LP.RIGHT_SHOULDER, c: LP.RIGHT_ELBOW,   targetDeg: 15, toleranceDeg: 10, weight: 0.5 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x:  0.18, y: -0.25 }, [LP.RIGHT_ELBOW]: { x: 0.18, y: -0.08 }, [LP.RIGHT_WRIST]: { x: 0.38, y: -0.08 },
      [LP.LEFT_SHOULDER]:  { x: -0.18, y: -0.25 }, [LP.LEFT_ELBOW]:  { x: -0.18, y: -0.05 }, [LP.LEFT_WRIST]: { x: -0.18, y: 0.12 },
      [LP.RIGHT_HIP]: { x: 0.12, y: 0 }, [LP.LEFT_HIP]: { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]: { x: 0.13, y: 0.30 }, [LP.LEFT_KNEE]: { x: -0.13, y: 0.30 },
      [LP.RIGHT_ANKLE]: { x: 0.13, y: 0.60 }, [LP.LEFT_ANKLE]: { x: -0.13, y: 0.60 },
    },
  },
  {
    id: 'knee_extension', name: 'Knee Extension',
    description: 'Seated — straighten your leg fully',
    cues: ['Sit upright in your chair', 'Tighten your quadriceps', 'Slowly straighten your knee', 'Hold with leg fully extended'],
    joints: [
      { name: 'knee', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE,        targetDeg: 170, toleranceDeg: 10, weight: 0.8 },
      { name: 'hip',  a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE,     targetDeg: 95,  toleranceDeg: 15, weight: 0.2 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x: 0.18, y: -0.42 }, [LP.LEFT_SHOULDER]: { x: -0.18, y: -0.42 },
      [LP.RIGHT_ELBOW]: { x: 0.18, y: -0.22 }, [LP.LEFT_ELBOW]: { x: -0.18, y: -0.22 },
      [LP.RIGHT_WRIST]: { x: 0.18, y: -0.05 }, [LP.LEFT_WRIST]: { x: -0.18, y: -0.05 },
      [LP.RIGHT_HIP]: { x: 0.12, y: 0 }, [LP.LEFT_HIP]: { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]: { x: 0.38, y: 0.02 }, [LP.LEFT_KNEE]: { x: -0.13, y: 0.28 },
      [LP.RIGHT_ANKLE]: { x: 0.62, y: 0.04 }, [LP.LEFT_ANKLE]: { x: -0.13, y: 0.52 },
    },
  },
  {
    id: 'knee_flexion', name: 'Knee Flexion',
    description: 'Standing — bend your knee to 90° behind you',
    cues: ['Stand on your left leg', 'Hold a surface if needed for balance', 'Keep your thighs level', 'Bend knee until heel is level with opposite knee'],
    joints: [
      { name: 'knee', a: LP.RIGHT_HIP, b: LP.RIGHT_KNEE, c: LP.RIGHT_ANKLE,     targetDeg: 90,  toleranceDeg: 15, weight: 0.8 },
      { name: 'hip',  a: LP.RIGHT_SHOULDER, b: LP.RIGHT_HIP, c: LP.RIGHT_KNEE,  targetDeg: 175, toleranceDeg: 12, weight: 0.2 },
    ],
    targetOffsets: {
      [LP.RIGHT_SHOULDER]: { x: 0.18, y: -0.42 }, [LP.LEFT_SHOULDER]: { x: -0.18, y: -0.42 },
      [LP.RIGHT_ELBOW]: { x: 0.18, y: -0.22 }, [LP.LEFT_ELBOW]: { x: -0.18, y: -0.22 },
      [LP.RIGHT_WRIST]: { x: 0.18, y: -0.05 }, [LP.LEFT_WRIST]: { x: -0.18, y: -0.05 },
      [LP.RIGHT_HIP]: { x: 0.12, y: 0 }, [LP.LEFT_HIP]: { x: -0.12, y: 0 },
      [LP.RIGHT_KNEE]: { x: 0.12, y: 0.28 }, [LP.LEFT_KNEE]: { x: -0.13, y: 0.30 },
      [LP.RIGHT_ANKLE]: { x: 0.28, y: 0.12 }, [LP.LEFT_ANKLE]: { x: -0.13, y: 0.60 },
    },
  },
];

// ─── Geometry ─────────────────────────────────────────────────────────────────
function angleDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const mag = Math.sqrt(ba.x ** 2 + ba.y ** 2) * Math.sqrt(bc.x ** 2 + bc.y ** 2);
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function computeMatch(landmarks: Landmark[], pose: ExercisePose): number {
  let totalW = 0; let scored = 0;
  for (const j of pose.joints) {
    const a = landmarks[j.a]; const b = landmarks[j.b]; const c = landmarks[j.c];
    if (!a || !b || !c) continue;
    if ((a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3 || (c.visibility ?? 1) < 0.3) continue;
    const delta = Math.abs(angleDeg(a, b, c) - j.targetDeg);
    scored += Math.max(0, 1 - delta / (j.toleranceDeg * 2)) * j.weight;
    totalW += j.weight;
  }
  return totalW > 0 ? scored / totalW : 0;
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────
const CONNECTIONS: [number, number][] = [
  [LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER],
  [LP.LEFT_SHOULDER, LP.LEFT_ELBOW],   [LP.LEFT_ELBOW, LP.LEFT_WRIST],
  [LP.RIGHT_SHOULDER, LP.RIGHT_ELBOW], [LP.RIGHT_ELBOW, LP.RIGHT_WRIST],
  [LP.LEFT_SHOULDER, LP.LEFT_HIP],     [LP.RIGHT_SHOULDER, LP.RIGHT_HIP],
  [LP.LEFT_HIP, LP.RIGHT_HIP],
  [LP.LEFT_HIP, LP.LEFT_KNEE],         [LP.LEFT_KNEE, LP.LEFT_ANKLE],
  [LP.RIGHT_HIP, LP.RIGHT_KNEE],       [LP.RIGHT_KNEE, LP.RIGHT_ANKLE],
];

function drawGhost(ctx: CanvasRenderingContext2D, offsets: Partial<Record<number, Vec2>>, anchor: Vec2, scale: number, score: number) {
  const g = Math.floor(score * 255);
  const b = Math.floor((1 - score) * 200);
  const pos = (i: number): Vec2 | null => { const o = offsets[i]; return o ? { x: anchor.x + o.x * scale, y: anchor.y + o.y * scale } : null; };

  // Torso fill
  const corners = [LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER, LP.RIGHT_HIP, LP.LEFT_HIP].map(pos).filter(Boolean) as Vec2[];
  if (corners.length === 4) {
    ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
    ctx.fillStyle = `rgba(${g},${Math.floor(g*0.3)},${b},0.06)`; ctx.fill();
  }

  ctx.setLineDash([7, 5]); ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  for (const [a, bIdx] of CONNECTIONS) {
    const pA = pos(a); const pB = pos(bIdx);
    if (!pA || !pB) continue;
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y);
    ctx.strokeStyle = `rgba(${g},${Math.floor(g*0.5)},${b},0.5)`; ctx.stroke();
  }
  ctx.setLineDash([]);

  Object.keys(offsets).map(Number).forEach(i => {
    const p = pos(i); if (!p) return;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${g},${Math.floor(g*0.5)},${b},0.65)`; ctx.fill();
  });
}

function drawLive(ctx: CanvasRenderingContext2D, lms: Landmark[], w: number, h: number, score: number) {
  const matched = score >= 0.85;
  const col = matched ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.88)';
  const p = (lm: Landmark): Vec2 => ({ x: lm.x * w, y: lm.y * h });

  ctx.setLineDash([]); ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a, b] of CONNECTIONS) {
    const lA = lms[a]; const lB = lms[b];
    if (!lA || !lB || (lA.visibility ?? 1) < 0.2 || (lB.visibility ?? 1) < 0.2) continue;
    const pA = p(lA); const pB = p(lB);
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y);
    ctx.strokeStyle = col; ctx.stroke();
  }
  [LP.LEFT_SHOULDER, LP.RIGHT_SHOULDER, LP.LEFT_ELBOW, LP.RIGHT_ELBOW,
   LP.LEFT_WRIST, LP.RIGHT_WRIST, LP.LEFT_HIP, LP.RIGHT_HIP,
   LP.LEFT_KNEE, LP.RIGHT_KNEE, LP.LEFT_ANKLE, LP.RIGHT_ANKLE].forEach(i => {
    const lm = lms[i]; if (!lm || (lm.visibility ?? 1) < 0.2) return;
    const pt = p(lm);
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PoseDemoRunner() {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef<number>(0);
  const landmarksRef = useRef<Landmark[]>([]);
  const exerciseRef  = useRef<ExercisePose>(POSE_LIBRARY[0]);

  const [exercise, setExercise]     = useState<ExercisePose>(POSE_LIBRARY[0]);
  const [score, setScore]           = useState(0);
  const [matchState, setMatchState] = useState<'idle'|'tracking'|'close'|'matched'>('idle');
  const [holdSecs, setHoldSecs]     = useState(0);
  const [reps, setReps]             = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [loading, setLoading]       = useState(true);
  const [cueIdx, setCueIdx]         = useState(0);
  const [showMenu, setShowMenu]     = useState(false);

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
    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -w, 0, w, h); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, 0, w, h);

    const lms = landmarksRef.current;
    if (lms.length > 0) {
      const mirrored = lms.map(lm => ({ ...lm, x: 1 - lm.x }));
      const s = computeMatch(lms, exerciseRef.current);
      setScore(s);
      setMatchState(s >= 0.85 ? 'matched' : s >= 0.55 ? 'close' : 'tracking');

      const lH = mirrored[LP.LEFT_HIP]; const rH = mirrored[LP.RIGHT_HIP];
      const anchor: Vec2 = (lH && rH)
        ? { x: ((lH.x + rH.x) / 2) * w, y: ((lH.y + rH.y) / 2) * h }
        : { x: w / 2, y: h * 0.55 };
      const scale = Math.min(w, h) * 0.72;

      drawGhost(ctx, exerciseRef.current.targetOffsets, anchor, scale, s);
      drawLive(ctx, mirrored, w, h, s);
    }
    animRef.current = requestAnimationFrame(renderLoop);
  }, []);

  // Init camera + MediaPipe via CDN
  useEffect(() => {
    let stopped = false;
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setCameraReady(true);

        // CDN load -- no npm imports, no webpack errors
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
    idle:     { label: 'Position yourself in frame', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    tracking: { label: 'Match the blue silhouette',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
    close:    { label: 'Almost there \u2014 keep going',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
    matched:  { label: `Hold \u2014 ${holdSecs}s / 5s`,   color: '#4ade80', bg: 'rgba(74,222,128,0.12)'  },
  }[matchState];

  const selectExercise = (ex: ExercisePose) => {
    setExercise(ex); setShowMenu(false); setReps(0); setScore(0); setMatchState('idle'); setCueIdx(0);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#080c14', fontFamily: "'DM Sans', 'SF Pro Display', system-ui, sans-serif", display: 'flex', flexDirection: 'column', color: '#f1f5f9' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,12,20,0.95)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>&#x2b21;</div>
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
          {POSE_LIBRARY.map(ex => (
            <button key={ex.id} onClick={() => selectExercise(ex)} style={{ width: '100%', display: 'block', padding: '12px 16px', textAlign: 'left', background: ex.id === exercise.id ? 'rgba(59,130,246,0.15)' : 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', color: ex.id === exercise.id ? '#60a5fa' : '#94a3b8', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              {ex.name}
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{ex.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Camera area */}
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

          {!loading && !cameraError && (
            <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(8,12,20,0.75)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 12px', border: `1px solid ${STATE.color}40`, minWidth: 80 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: STATE.color, lineHeight: 1 }}>{pct}%</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>match</div>
              <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: STATE.color, borderRadius: 2, transition: 'width 0.2s ease, background 0.3s ease' }} />
              </div>
            </div>
          )}

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
            {[['rgba(96,165,250,0.6)', 'Target pose'], ['rgba(255,255,255,0.7)', 'Your body'], ['rgba(74,222,128,0.8)', 'Matched \u2713']].map(([bg, label]) => (
              <span key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 12, height: 3, background: bg as string, borderRadius: 2 }} />
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
