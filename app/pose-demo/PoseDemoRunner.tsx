'use client';
// app/pose-demo/PoseDemoRunner.tsx
// Standalone investor-facing pose matching demo.
// Imports all movement intelligence from shared lib/pose/* modules.
// No duplicated coordinate math — single source of truth with SessionRunner.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getBodyFrame } from '@/lib/pose/bodyFrame';
import { POSE_BUILDERS, REST_BUILDERS, lerpGhost, computeMatchScore } from '@/lib/pose/poseBuilders';
import { drawGhost, drawGhostDemo, drawLive, drawHoldRing } from '@/lib/pose/ghostRenderer';

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

// \u2500\u2500\u2500 Exercise definitions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// id matches exercise_templates.slug.
// targetDeg matches exercise_templates.rom_norm_degrees (clinical population norm).

type Exercise = {
  id: string;
  clinicalName: string;
  name: string;
  description: string;
  targetDeg: number;
  holdTargetMs: number;
  cues: string[];
};

const EXERCISES: Exercise[] = [
  { id: 'shoulder_flexion_right',    clinicalName: 'Shoulder Flexion \u2014 Unilateral Right',    name: 'Right Arm Raise',   description: 'Raise your RIGHT arm forward and up (sagittal plane)',          targetDeg: 160, holdTargetMs: 5000, cues: ['Stand or sit tall', 'Keep right elbow straight', 'Raise RIGHT arm forward and up', 'Hold at the top'] },
  { id: 'shoulder_flexion_left',     clinicalName: 'Shoulder Flexion \u2014 Unilateral Left',     name: 'Left Arm Raise',    description: 'Raise your LEFT arm forward and up (sagittal plane)',           targetDeg: 160, holdTargetMs: 5000, cues: ['Stand or sit tall', 'Keep left elbow straight', 'Raise LEFT arm forward and up', 'Hold at the top'] },
  { id: 'shoulder_flexion_bilateral',clinicalName: 'Shoulder Flexion \u2014 Bilateral',           name: 'Both Arms Raise',   description: 'Raise BOTH arms forward and up simultaneously (sagittal plane)', targetDeg: 160, holdTargetMs: 5000, cues: ['Stand or sit tall', 'Keep elbows straight', 'Raise both arms forward and up', 'Hold at the top'] },
  { id: 'shoulder_abduction_right',  clinicalName: 'Shoulder Abduction \u2014 Unilateral Right',  name: 'Right Arm Out',     description: 'Raise your RIGHT arm out to the side (frontal plane)',           targetDeg: 150, holdTargetMs: 5000, cues: ['Face the camera', 'Keep right elbow straight', 'Raise RIGHT arm out to side', 'Hold level with shoulder'] },
  { id: 'shoulder_abduction_left',   clinicalName: 'Shoulder Abduction \u2014 Unilateral Left',   name: 'Left Arm Out',      description: 'Raise your LEFT arm out to the side (frontal plane)',            targetDeg: 150, holdTargetMs: 5000, cues: ['Face the camera', 'Keep left elbow straight', 'Raise LEFT arm out to side', 'Hold level with shoulder'] },
  { id: 'shoulder_abduction_bilateral',clinicalName:'Shoulder Abduction \u2014 Bilateral',        name: 'Both Arms Out',     description: 'Raise BOTH arms out to sides simultaneously (frontal plane)',    targetDeg: 150, holdTargetMs: 5000, cues: ['Face the camera', 'Keep elbows straight', 'Raise both arms out to sides', 'Hold level with shoulders'] },
  { id: 'sit_to_stand',              clinicalName: 'Sit to Stand Transfer',                       name: 'Sit to Stand',      description: 'Rise from seated to fully standing',                            targetDeg: 170, holdTargetMs: 3000, cues: ['Sit at front edge of chair', 'Lean slightly forward', 'Push through feet to stand', 'Stand tall, hips and knees extended'] },
  { id: 'knee_extension_right',      clinicalName: 'Knee Extension \u2014 Unilateral Right',      name: 'Right Leg Straighten', description: 'Seated: straighten your right knee fully',                   targetDeg: 160, holdTargetMs: 5000, cues: ['Sit upright', 'Tighten right quadriceps', 'Straighten right knee', 'Hold fully extended'] },
];

// \u2500\u2500\u2500 State machine constants \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
type Phase = 'demo' | 'attempt' | 'holding' | 'rep_complete';

const DEMO_CYCLE_S = 7;
const DEMO_CYCLES_FIRST = 2;
const DEMO_CYCLES_REPEAT = 1;
const INTENT_DELTA = 0.10;
const INTENT_MIN_SCORE = 0.20;
const INTENT_WINDOW = 20;
const MATCH_THRESHOLD = 0.85;
const FAILURE_THRESHOLD = 0.55;
const LOW_SCORE_TIMEOUT = 8;

function easeInOut(t: number): number { return t < 0.5 ? 4*t*t*t : 1-(-2*t+2)**3/2; }
function cycleT(elapsedS: number): number {
  const t = (elapsedS % DEMO_CYCLE_S) / DEMO_CYCLE_S;
  if (t < 0.14) return 0;
  if (t < 0.43) return easeInOut((t-0.14)/0.29);
  if (t < 0.64) return 1;
  if (t < 0.93) return 1-easeInOut((t-0.64)/0.29);
  return 0;
}
function demoLerp(elapsedS: number, isRepeat: boolean): { t: number; done: boolean } {
  const cycles = isRepeat ? DEMO_CYCLES_REPEAT : DEMO_CYCLES_FIRST;
  const totalS = DEMO_CYCLE_S * cycles;
  if (elapsedS >= totalS) return { t: cycleT(totalS-0.01), done: true };
  return { t: cycleT(elapsedS), done: false };
}

// \u2500\u2500\u2500 Component \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export default function PoseDemoRunner() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const lmsRef    = useRef<{ x:number; y:number; z:number; visibility?:number }[]>([]);
  const exRef     = useRef<Exercise>(EXERCISES[0]);
  const lastRef   = useRef<number>(performance.now());

  type Viewport = { scale:number; offsetX:number; offsetY:number };
  const vpRef         = useRef<Viewport>({ scale:1, offsetX:0, offsetY:0 });
  const autoFrameRef  = useRef(true);
  const manualZoomRef = useRef(1.0);

  const phaseRef      = useRef<Phase>('demo');
  const phaseStartRef = useRef<number>(performance.now());
  const holdStartRef  = useRef<number|null>(null);
  const lowScoreRef   = useRef(0);
  const isRepeatRef   = useRef(false);
  const histRef       = useRef<number[]>([]);

  const [exercise, setExercise]           = useState<Exercise>(EXERCISES[0]);
  const [score, setScore]                 = useState(0);
  const [phase, setPhase]                 = useState<Phase>('demo');
  const [holdElapsedMs, setHoldElapsedMs] = useState(0);
  const [reps, setReps]                   = useState(0);
  const [cameraReady, setCameraReady]     = useState(false);
  const [cameraError, setCameraError]     = useState('');
  const [loading, setLoading]             = useState(true);
  const [showMenu, setShowMenu]           = useState(false);
  const [autoFrame, setAutoFrame]         = useState(true);
  const [manualZoom, setManualZoom]       = useState(1.0);
  const [showControls, setShowControls]   = useState(false);
  const [isMobile, setIsMobile]           = useState(false);
  const [phaseLabel, setPhaseLabel]       = useState('Watch carefully\u2026');
  const [phaseColor, setPhaseColor]       = useState('#60a5fa');
  const [phaseBg, setPhaseBg]             = useState('rgba(96,165,250,0.12)');
  const [demoProgress, setDemoProgress]   = useState(0);

  useEffect(() => { exRef.current = exercise; }, [exercise]);
  useEffect(() => { autoFrameRef.current = autoFrame; }, [autoFrame]);
  useEffect(() => { manualZoomRef.current = manualZoom; }, [manualZoom]);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check(); window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const startPhase = useCallback((p: Phase, repeat = false) => {
    phaseRef.current = p; phaseStartRef.current = performance.now();
    lowScoreRef.current = 0; holdStartRef.current = null; histRef.current = [];
    if (p === 'demo') isRepeatRef.current = repeat;
    setPhase(p); setHoldElapsedMs(0);
  }, []);

  const renderLoop = useCallback(() => {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas) { animRef.current = requestAnimationFrame(renderLoop); return; }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width; const H = canvas.height;
    const now = performance.now();
    const deltaS = Math.min((now - lastRef.current) / 1000, 0.1);
    lastRef.current = now;

    ctx.clearRect(0, 0, W, H);
    const lms = lmsRef.current;
    const mir = lms.length > 0 ? lms.map(lm => ({ ...lm, x: 1-lm.x })) : [];

    // Auto-frame
    let tScale = manualZoomRef.current, tOX = 0, tOY = 0;
    if (autoFrameRef.current && mir.length > 0) {
      const vis = mir.filter(lm => (lm.visibility??1) > 0.15);
      if (vis.length >= 2) {
        let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
        for (const lm of vis) { mnX=Math.min(mnX,lm.x*W); mxX=Math.max(mxX,lm.x*W); mnY=Math.min(mnY,lm.y*H); mxY=Math.max(mxY,lm.y*H); }
        const pX=(mxX-mnX)*0.35+20, pY=(mxY-mnY)*0.28+20;
        const bx=Math.max(0,mnX-pX), by=Math.max(0,mnY-pY);
        const bw=Math.min(W,mxX+pX)-bx, bh=Math.min(H,mxY+pY)-by;
        tScale=Math.max(1,Math.min(4,Math.min(W/bw,H/bh)*manualZoomRef.current));
        tOX=W/2-(bx+bw/2)*tScale; tOY=H/2-(by+bh/2)*tScale;
      }
    }
    const L=0.07; const vp=vpRef.current;
    vp.scale+=(tScale-vp.scale)*L; vp.offsetX+=(tOX-vp.offsetX)*L; vp.offsetY+=(tOY-vp.offsetY)*L;

    ctx.save(); ctx.setTransform(vp.scale,0,0,vp.scale,vp.offsetX,vp.offsetY);
    ctx.save(); ctx.scale(-1,1); ctx.drawImage(video,-W,0,W,H); ctx.restore();
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(0,0,W,H); ctx.restore();

    if (mir.length > 0) {
      const elapsed = (now - phaseStartRef.current) / 1000;
      const p = phaseRef.current;
      const ex = exRef.current;
      const s = computeMatchScore(mir, ex.id, W, H);
      setScore(s);
      const frame = getBodyFrame(mir as any, W, H);

      ctx.save(); ctx.setTransform(vp.scale,0,0,vp.scale,vp.offsetX,vp.offsetY);
      if (frame) {
        const tb = POSE_BUILDERS[ex.id];
        const rb = REST_BUILDERS[ex.id];
        if (tb && rb) {
          const tgt = tb(frame, ex.targetDeg);
          const rst = rb(frame);

          if (p === 'demo') {
            const isRep = isRepeatRef.current;
            const { t, done } = demoLerp(elapsed, isRep);
            setDemoProgress(Math.min(elapsed / (DEMO_CYCLE_S*(isRep?DEMO_CYCLES_REPEAT:DEMO_CYCLES_FIRST)), 1));
            const hist = histRef.current; hist.push(s); if (hist.length > INTENT_WINDOW) hist.shift();
            const intent = hist.length >= INTENT_WINDOW && s >= INTENT_MIN_SCORE && (s-hist[0]) >= INTENT_DELTA;
            if (intent) {
              setPhaseLabel('Good \u2014 now hold that position!'); setPhaseColor('#4ade80'); setPhaseBg('rgba(74,222,128,0.12)');
              startPhase('attempt');
            } else {
              drawGhostDemo(ctx, lerpGhost(rst, tgt, t), t);
              if (done) { setPhaseLabel('Your turn \u2014 match the pose'); setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)'); startPhase('attempt'); }
              else if (t < 0.05) { setPhaseLabel(isRep?'Watch again\u2026':'Watch carefully\u2026'); setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)'); }
              else if (t < 0.95) { setPhaseLabel('Follow this movement'); setPhaseColor('#a78bfa'); setPhaseBg('rgba(167,139,250,0.12)'); }
              else               { setPhaseLabel('Hold at the top');      setPhaseColor('#a78bfa'); setPhaseBg('rgba(167,139,250,0.12)'); }
            }

          } else if (p === 'attempt' || p === 'holding') {
            drawGhost(ctx, tgt, s);
            if (s >= MATCH_THRESHOLD) {
              lowScoreRef.current = 0;
              if (!holdStartRef.current) { holdStartRef.current = now; phaseRef.current='holding'; setPhase('holding'); }
              const held = now - (holdStartRef.current ?? now);
              setHoldElapsedMs(held);
              drawHoldRing(ctx, W, H, held, ex.holdTargetMs, s);
              if (held >= ex.holdTargetMs) {
                setReps(r=>r+1); startPhase('rep_complete');
                setPhaseLabel('Rep complete \u2014 well done!'); setPhaseColor('#4ade80'); setPhaseBg('rgba(74,222,128,0.12)');
                setTimeout(()=>startPhase('attempt'), 1500);
              } else {
                const sl = Math.max(1, Math.ceil((ex.holdTargetMs-held)/1000));
                setPhaseLabel(`Great form \u2014 hold ${sl}s`); setPhaseColor('#4ade80'); setPhaseBg('rgba(74,222,128,0.12)');
              }
            } else {
              holdStartRef.current = null;
              if (phaseRef.current==='holding') { phaseRef.current='attempt'; setPhase('attempt'); }
              lowScoreRef.current += deltaS; setHoldElapsedMs(0);
              if (s >= FAILURE_THRESHOLD) { setPhaseLabel('Almost there \u2014 keep adjusting'); setPhaseColor('#fbbf24'); setPhaseBg('rgba(251,191,36,0.12)'); lowScoreRef.current=0; }
              else { setPhaseLabel('Match the blue silhouette'); setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)'); }
              if (lowScoreRef.current > LOW_SCORE_TIMEOUT) { setPhaseLabel('Let me show you again\u2026'); setPhaseColor('#a78bfa'); setPhaseBg('rgba(167,139,250,0.12)'); setDemoProgress(0); startPhase('demo',true); }
            }
          } else if (p === 'rep_complete') {
            drawGhost(ctx, tgt, 1);
          }
        }
      }
      drawLive(ctx, mir, W, H, s);
      ctx.restore();
    }
    animRef.current = requestAnimationFrame(renderLoop);
  }, [startPhase]);

  useEffect(() => {
    let stopped = false;
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:640, height:480 } });
        if (stopped) { stream.getTracks().forEach(t=>t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject=stream; await videoRef.current.play(); }
        setCameraReady(true);
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
        if (stopped) return;
        const pose = new window.Pose({ locateFile:(f:string)=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
        pose.setOptions({ modelComplexity:1, smoothLandmarks:true, enableSegmentation:false, minDetectionConfidence:0.5, minTrackingConfidence:0.5 });
        pose.onResults((r:any) => { if (r.poseLandmarks) lmsRef.current = r.poseLandmarks; });
        setLoading(false);
        const camera = new window.Camera(videoRef.current!, { onFrame:async()=>{ await pose.send({image:videoRef.current!}); }, width:640, height:480 });
        camera.start();
        animRef.current = requestAnimationFrame(renderLoop);
      } catch(e:any) { setCameraError(e?.message??'Camera access denied'); setLoading(false); }
    };
    init();
    return () => { stopped=true; cancelAnimationFrame(animRef.current); if(videoRef.current?.srcObject)(videoRef.current.srcObject as MediaStream).getTracks().forEach(t=>t.stop()); };
  }, [renderLoop]);

  const pick = (ex: Exercise) => {
    setExercise(ex); setShowMenu(false); setReps(0); setScore(0);
    setPhaseLabel('Watch carefully\u2026'); setPhaseColor('#60a5fa'); setPhaseBg('rgba(96,165,250,0.12)');
    setDemoProgress(0); setHoldElapsedMs(0);
    isRepeatRef.current=false; histRef.current=[]; phaseRef.current='demo';
    phaseStartRef.current=performance.now(); holdStartRef.current=null; lowScoreRef.current=0;
  };

  const pct = Math.round(score*100);
  const wrapStyle: React.CSSProperties = isMobile
    ? {height:'100dvh',overflow:'hidden',background:'#080c14',fontFamily:"'DM Sans',system-ui,sans-serif",display:'flex',flexDirection:'column',color:'#f1f5f9'}
    : {minHeight:'100vh',background:'#080c14',fontFamily:"'DM Sans',system-ui,sans-serif",display:'flex',flexDirection:'column',color:'#f1f5f9'};
  const cameraStyle: React.CSSProperties = isMobile
    ? {flex:1,position:'relative',overflow:'hidden',minHeight:0}
    : {position:'relative',width:'100%',maxWidth:700,margin:'0 auto',aspectRatio:'4/3'};
  const bottomStyle: React.CSSProperties = isMobile
    ? {flexShrink:0,background:'rgba(8,12,20,0.97)',borderTop:'1px solid rgba(255,255,255,0.06)',padding:'10px 14px 16px',display:'flex',flexDirection:'column',gap:8}
    : {maxWidth:700,width:'100%',margin:'0 auto',padding:'12px 0 24px',display:'flex',flexDirection:'column',gap:8};

  return (
    <div style={wrapStyle}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,0.06)',background:'rgba(8,12,20,0.97)',backdropFilter:'blur(12px)',flexShrink:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:28,height:28,borderRadius:7,background:'linear-gradient(135deg,#3b82f6,#06b6d4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>&#x2b21;</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,letterSpacing:'-0.02em',lineHeight:1.2}}>Rehably</div>
            <div style={{fontSize:9,color:'#64748b',letterSpacing:'0.06em',textTransform:'uppercase'}}>Movement Guide</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{padding:'3px 10px',borderRadius:20,background:'rgba(59,130,246,0.12)',border:'1px solid rgba(59,130,246,0.25)',fontSize:12,fontWeight:700,color:'#60a5fa'}}>{reps} rep{reps!==1?'s':''}</div>
          <button onClick={()=>setShowMenu(m=>!m)} style={{padding:'5px 10px',borderRadius:8,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#cbd5e1',fontSize:11,fontWeight:500,cursor:'pointer',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{exercise.name} &#9662;</button>
        </div>
      </div>

      {/* Exercise menu */}
      {showMenu && (
        <div style={{position:'fixed',top:56,right:10,left:10,zIndex:100,background:'#0f172a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.7)'}}>
          {EXERCISES.map(ex=>(
            <button key={ex.id} onClick={()=>pick(ex)} style={{width:'100%',display:'block',padding:'12px 16px',textAlign:'left',background:ex.id===exercise.id?'rgba(59,130,246,0.15)':'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.04)',color:ex.id===exercise.id?'#60a5fa':'#e2e8f0',fontSize:13,fontWeight:600,cursor:'pointer'}}>
              {ex.name}
              <div style={{fontSize:11,color:'#475569',marginTop:2,fontWeight:400}}>{ex.clinicalName}</div>
              <div style={{fontSize:11,color:'#334155',marginTop:1,fontWeight:400}}>{ex.description} \u00b7 target {ex.targetDeg}\u00b0</div>
            </button>
          ))}
        </div>
      )}

      {/* Camera */}
      <div style={cameraStyle}>
        <video ref={videoRef} style={{display:'none'}} playsInline muted/>
        <canvas ref={canvasRef} width={640} height={480} style={{width:'100%',height:'100%',display:'block',background:'#0a0f1e'}}/>
        {loading && (
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',gap:12}}>
            <div style={{width:40,height:40,borderRadius:'50%',border:'3px solid rgba(96,165,250,0.2)',borderTop:'3px solid #60a5fa',animation:'spin 0.8s linear infinite'}}/>
            <div style={{fontSize:13,color:'#64748b'}}>{cameraReady?'Loading pose detection\u2026':'Requesting camera\u2026'}</div>
          </div>
        )}
        {cameraError && (
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.92)',gap:8,padding:24}}>
            <div style={{fontSize:32}}>&#128247;</div>
            <div style={{fontSize:14,fontWeight:600,color:'#f87171'}}>Camera access needed</div>
            <div style={{fontSize:12,color:'#64748b',textAlign:'center'}}>{cameraError}</div>
          </div>
        )}
        {!loading&&!cameraError&&phase!=='holding'&&(
          <div style={{position:'absolute',top:14,left:14,background:'rgba(8,12,20,0.78)',backdropFilter:'blur(8px)',borderRadius:10,padding:'8px 12px',border:`1px solid ${phaseColor}40`,minWidth:80}}>
            <div style={{fontSize:22,fontWeight:800,color:phaseColor,lineHeight:1}}>{pct}%</div>
            <div style={{fontSize:10,color:'#64748b',marginTop:2}}>match</div>
            <div style={{marginTop:6,height:3,borderRadius:2,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:phaseColor,borderRadius:2,transition:'width 0.2s ease'}}/>
            </div>
          </div>
        )}
        {!loading&&!cameraError&&(
          <div style={{position:'absolute',bottom:14,right:14,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
            {showControls&&(
              <div style={{background:'rgba(8,12,20,0.88)',backdropFilter:'blur(12px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:'12px 14px',minWidth:200,display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                  <span style={{fontSize:12,color:'#94a3b8',fontWeight:500}}>Auto-frame</span>
                  <button onClick={()=>setAutoFrame(a=>!a)} style={{width:40,height:22,borderRadius:11,border:'none',cursor:'pointer',background:autoFrame?'#3b82f6':'rgba(255,255,255,0.12)',position:'relative',transition:'background 0.2s'}}>
                    <span style={{position:'absolute',top:3,left:autoFrame?20:3,width:16,height:16,borderRadius:'50%',background:'#fff',transition:'left 0.2s',display:'block'}}/>
                  </button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:12,color:'#94a3b8'}}>Zoom</span><span style={{fontSize:12,color:'#60a5fa',fontWeight:600}}>{manualZoom.toFixed(1)}x</span></div>
                  <input type="range" min={0.5} max={3} step={0.05} value={manualZoom} onChange={e=>setManualZoom(Number(e.target.value))} style={{width:'100%',accentColor:'#3b82f6',cursor:'pointer'}}/>
                </div>
                <button onClick={()=>{setManualZoom(1.0);setAutoFrame(true);}} style={{fontSize:11,color:'#64748b',background:'transparent',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,padding:'4px 0',cursor:'pointer'}}>Reset to default</button>
              </div>
            )}
            <button onClick={()=>setShowControls(s=>!s)} style={{width:36,height:36,borderRadius:10,border:'none',cursor:'pointer',background:showControls?'rgba(59,130,246,0.3)':'rgba(8,12,20,0.75)',backdropFilter:'blur(8px)',color:'#94a3b8',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',outline:showControls?'1px solid rgba(59,130,246,0.5)':'1px solid rgba(255,255,255,0.08)'}}>&#9654;&#9650;</button>
          </div>
        )}
        {!loading&&!cameraError&&autoFrame&&(
          <div style={{position:'absolute',bottom:14,left:14,display:'flex',alignItems:'center',gap:5,background:'rgba(8,12,20,0.72)',backdropFilter:'blur(6px)',borderRadius:20,padding:'4px 10px',border:'1px solid rgba(59,130,246,0.25)'}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#3b82f6',animation:'pulse 2s ease infinite'}}/>
            <span style={{fontSize:10,color:'#60a5fa',fontWeight:500,letterSpacing:'0.04em'}}>AUTO-FRAME</span>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div style={bottomStyle}>
        <div style={{display:'flex',alignItems:'center',gap:8,background:phaseBg,border:`1px solid ${phaseColor}40`,borderRadius:10,padding:'10px 14px',transition:'all 0.4s ease'}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:phaseColor,boxShadow:`0 0 8px ${phaseColor}`,animation:'pulse 1.5s ease infinite',flexShrink:0}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600,color:phaseColor}}>{phaseLabel}</div>
            {phase==='holding'&&<div style={{fontSize:11,color:'#64748b',marginTop:1}}>{Math.round((holdElapsedMs/exercise.holdTargetMs)*100)}% complete</div>}
          </div>
          <div style={{padding:'2px 10px',borderRadius:20,background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.3)',fontSize:12,fontWeight:700,color:'#60a5fa'}}>{reps} rep{reps!==1?'s':''}</div>
        </div>
        {phase==='demo'&&(
          <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(167,139,250,0.2)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
              <span style={{fontSize:11,color:'#a78bfa',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>&#9654; Demo in progress</span>
              <span style={{fontSize:11,color:'#64748b'}}>{Math.round(demoProgress*100)}%</span>
            </div>
            <div style={{height:4,borderRadius:2,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${demoProgress*100}%`,background:'linear-gradient(90deg,#60a5fa,#a78bfa)',borderRadius:2,transition:'width 0.3s ease'}}/>
            </div>
            <div style={{fontSize:11,color:'#64748b',marginTop:6}}>Watch the silhouette \u2014 target {exercise.targetDeg}\u00b0 range of motion</div>
          </div>
        )}
        {(phase==='attempt'||phase==='holding')&&(
          <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px',display:'flex',alignItems:'center',gap:12}}>
            <div><div style={{fontSize:22,fontWeight:800,color:phaseColor,lineHeight:1}}>{pct}%</div><div style={{fontSize:10,color:'#64748b',marginTop:1}}>match</div></div>
            <div style={{flex:1}}>
              <div style={{height:6,borderRadius:3,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:phaseColor,borderRadius:3,transition:'width 0.15s ease'}}/>
              </div>
              <div style={{fontSize:11,color:'#64748b',marginTop:5}}>{pct<55?'Keep trying \u2014 demo repeats if needed':pct<85?'Getting close!':'Hold this position'}</div>
            </div>
          </div>
        )}
        <div style={{display:'flex',gap:12,padding:'2px 0',fontSize:11,color:'#475569',flexWrap:'wrap'}}>
          {([['rgba(167,139,250,0.7)','Demo'],['rgba(96,165,250,0.7)','Target'],['rgba(255,255,255,0.7)','You'],['rgba(74,222,128,0.8)','\u2713 Match']] as const).map(([bg,label])=>(
            <span key={label} style={{display:'flex',alignItems:'center',gap:4}}><span style={{display:'inline-block',width:10,height:3,background:bg,borderRadius:2}}/>{label}</span>
          ))}
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
