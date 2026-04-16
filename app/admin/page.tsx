"use client";

// app/admin/page.tsx — Module 7
// Three tabs: Exercise Library | Patients | Protocols
// Sessions tab → Template Builder (no patient assignment)
// Patient profile → Assign Session flow (picks template, applies overrides)
// Patient profile → View Results (completed session drill-down)

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ExerciseTemplate, CoachingStrings } from "@/lib/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Patient {
  id: string; first_name: string; last_name: string; full_name: string;
  patient_type: string; condition_notes: string | null; goals: string | null;
  date_of_birth: string | null; height_cm: number | null; weight_kg: number | null;
  photo_url: string | null; created_at: string;
}

interface PatientForm {
  first_name: string; last_name: string; date_of_birth: string; patient_type: string;
  condition_notes: string; goals: string; height_cm: string; weight_kg: string;
  height_unit: "cm" | "ft"; weight_unit: "kg" | "lbs";
  height_ft: string; height_in: string; weight_lbs: string;
}

interface SessionTemplate {
  id: string; title: string; objective: string | null;
  estimated_duration_mins: number; tags: string[]; created_at: string;
  exercises: SessionTemplateExercise[];
}

interface SessionTemplateExercise {
  id: string; template_id: string; exercise_template_id: string;
  sequence_order: number; default_reps: number | null; default_hold_ms: number | null;
  exercise_template?: {
    id: string; display_name: string; default_reps: number; default_hold_ms: number; exercise_type: string;
    rom_start_degrees: number | null; rom_norm_degrees: number | null;
    rom_max_degrees: number | null; rom_acceptable_min: number | null;
  };
}

interface PrescribedSession {
  id: string; title: string; objective: string | null; patient_id: string | null;
  status: string; estimated_duration_mins: number; created_at: string;
  source_protocol_id: string | null;
  exercises: { display_name: string; reps: number; hold_ms: number; sequence_order: number; }[];
}

interface SessionResult {
  id: string; prescription_id: string | null; patient_id: string | null;
  started_at: string; completed_at: string | null; duration_ms: number | null;
  mobility_score: number | null; claude_summary: string | null;
  exercise_results: ExerciseResult[];
}

interface RepTimelineEntry {
  rep: number; outcome: "success" | "failed"; failureReason: string | null;
  peakRomDeg: number | null; holdMs: number | null; timestampMs: number;
}

interface ExerciseResult {
  id: string; sequence_order: number;
  reps_prescribed: number; reps_attempted: number; reps_successful: number; reps_failed: number;
  hold_compliance_rate: number | null;
  failed_hold_count: number; failed_height_count: number;
  failed_balance_count: number; failed_isolation_count: number;
  avg_metric_degrees: number | null; target_metric_degrees: number | null;
  avg_hold_ms: number | null; landmark_confidence_pct: number | null;
  movement_timeline: RepTimelineEntry[] | null;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: "#0d1117", surface: "#161b22", surfaceHover: "#1c2230",
  border: "#21262d", borderFocus: "#388bfd",
  text: "#e6edf3", textMuted: "#7d8590", textDim: "#484f58",
  green: "#3fb950", greenDim: "rgba(63,185,80,0.12)",
  blue: "#388bfd", blueDim: "rgba(56,139,253,0.12)",
  orange: "#d29922", orangeDim: "rgba(210,153,34,0.12)",
  red: "#f85149", redDim: "rgba(248,81,73,0.12)",
  purple: "#a371f7", purpleDim: "rgba(163,113,247,0.12)",
};

const PATIENT_TYPE_LABELS: Record<string, string> = {
  general_fitness: "General Fitness", post_surgery: "Post Surgery",
  senior: "Senior / Elderly", chronic_pain: "Chronic Pain",
};
const PATIENT_TYPE_COLORS: Record<string, string> = {
  general_fitness: C.blue, post_surgery: C.orange, senior: C.purple, chronic_pain: C.green,
};

const SUGGESTED_TAGS = [
  "shoulder","knee","hip","back","ankle","wrist",
  "strength","balance","mobility","flexibility","stability",
  "post_surgery","chronic_pain","senior","general_fitness",
  "upper_body","lower_body","full_body","beginner","intermediate","advanced",
];

// Exercise type metadata — label + accent colour + icon
const EXERCISE_TYPE_META: Record<string, { label: string; accent: string; accentDim: string; icon: string }> = {
  shoulder_flexion:   { label: "Shoulder Flexion",   accent: C.blue,   accentDim: C.blueDim,   icon: "💪" },
  shoulder_abduction: { label: "Shoulder Abduction",  accent: C.purple, accentDim: C.purpleDim, icon: "🙌" },
  sit_to_stand:       { label: "Sit to Stand",        accent: C.green,  accentDim: C.greenDim,  icon: "🦵" },
  knee_extension:     { label: "Knee Extension",      accent: C.orange, accentDim: C.orangeDim, icon: "🦵" },
  knee_flexion:       { label: "Knee Flexion",        accent: C.orange, accentDim: C.orangeDim, icon: "🦵" },
  custom:             { label: "Custom",              accent: C.blue,   accentDim: C.blueDim,   icon: "⚡" },
};

function getTypeMeta(type: string) {
  return EXERCISE_TYPE_META[type] ?? { label: type, accent: C.blue, accentDim: C.blueDim, icon: "⚡" };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function calcAge(dob: string) {
  const b = new Date(dob), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function calcBMI(h: number, w: number) { const hm = h / 100; return Math.round(w / (hm * hm) * 10) / 10; }
function bmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: "Underweight", color: C.blue };
  if (bmi < 25)   return { label: "Normal",      color: C.green };
  if (bmi < 30)   return { label: "Overweight",  color: C.orange };
  return               { label: "Obese",         color: C.red };
}
function cmToFtIn(cm: number) { const i = cm / 2.54; return { ft: Math.floor(i / 12), inches: Math.round(i % 12) }; }
function ftInToCm(ft: number, inches: number) { return Math.round((ft * 12 + inches) * 2.54); }
function kgToLbs(kg: number) { return Math.round(kg * 2.20462 * 10) / 10; }
function lbsToKg(lbs: number) { return Math.round(lbs / 2.20462 * 10) / 10; }
function msToSeconds(ms: number) { return (ms / 1000).toFixed(1); }
function secondsToMs(s: string) { return Math.round(parseFloat(s) * 1000); }
function formatDate(d: string) { return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }); }
function formatDuration(ms: number) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; }
function emptyForm(): PatientForm {
  return { first_name: "", last_name: "", date_of_birth: "", patient_type: "general_fitness",
    condition_notes: "", goals: "", height_cm: "", weight_kg: "", height_ft: "", height_in: "",
    weight_lbs: "", height_unit: "cm", weight_unit: "kg" };
}

// ─── Shared UI Components ─────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const, color, background: color + "20", border: `1px solid ${color}40` }}>{label}</span>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{label}</label>{children}{hint && <p style={{ fontSize: 11, color: C.textDim, margin: 0 }}>{hint}</p>}</div>;
}
function Input({ value, onChange, type = "text", placeholder, min, max, step, style: s }: { value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string; min?: number; max?: number; step?: number; style?: React.CSSProperties; }) {
  return <input type={type} value={value} placeholder={placeholder} min={min} max={max} step={step} onChange={e => onChange(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" as const, ...s }} onFocus={e => (e.target.style.borderColor = C.borderFocus)} onBlur={e => (e.target.style.borderColor = C.border)} />;
}
function Textarea({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; }) {
  return <textarea value={value} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const, lineHeight: 1.6 }} onFocus={e => (e.target.style.borderColor = C.borderFocus)} onBlur={e => (e.target.style.borderColor = C.border)} />;
}
function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode; }) {
  return <select value={value} onChange={e => onChange(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", cursor: "pointer" }}>{children}</select>;
}
function UnitToggle({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void; }) {
  return <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>{options.map(opt => <button key={opt} onClick={() => onChange(opt)} style={{ background: value === opt ? C.blue : "transparent", color: value === opt ? "#fff" : C.textMuted, border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{opt}</button>)}</div>;
}
function Btn({ children, onClick, variant = "ghost", disabled, small, fullWidth }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger" | "success"; disabled?: boolean; small?: boolean; fullWidth?: boolean; }) {
  const s = { primary: { bg: C.blue, color: "#fff", border: C.blue }, ghost: { bg: "transparent", color: C.text, border: C.border }, danger: { bg: "transparent", color: C.red, border: C.red + "60" }, success: { bg: C.green, color: "#fff", border: C.green } }[variant];
  return <button onClick={onClick} disabled={disabled} style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: small ? "4px 10px" : "8px 16px", fontSize: small ? 12 : 13, fontWeight: 500, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap" as const, width: fullWidth ? "100%" : "auto" }}>{children}</button>;
}
function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}><h3 style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: 0 }}>{title}</h3>{action}</div>;
}
function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 300, background: ok ? C.greenDim : C.redDim, border: `1px solid ${ok ? C.green : C.red}40`, color: ok ? C.green : C.red, borderRadius: 8, padding: "12px 18px", fontSize: 13, fontWeight: 500, boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>{ok ? "✓" : "✕"} {msg}</div>;
}

// ─── Patient Photo ────────────────────────────────────────────────────────────

function PatientPhoto({ photoUrl, name, size = 64, editable = false, onUpload }: { photoUrl: string | null; name: string; size?: number; editable?: boolean; onUpload?: (url: string) => void; }) {
  const supabase = getSupabaseClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("patient-photos").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("patient-photos").getPublicUrl(path);
      onUpload?.(data.publicUrl);
    } catch (err) { console.error("Upload failed:", err); }
    finally { setUploading(false); }
  };

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setStream(s); setShowCamera(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch (err) { console.error("Camera error:", err); }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async blob => {
      if (blob) {
        await uploadFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
        stream?.getTracks().forEach(t => t.stop()); setStream(null); setShowCamera(false);
      }
    }, "image/jpeg", 0.9);
  };

  const stopCamera = () => { stream?.getTracks().forEach(t => t.stop()); setStream(null); setShowCamera(false); };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div style={{ width: size, height: size, borderRadius: "50%", background: photoUrl ? "transparent" : `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.3, fontWeight: 700, color: "#fff", overflow: "hidden", border: `2px solid ${C.border}`, flexShrink: 0 }}>
        {photoUrl ? <img src={photoUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
      </div>
      {editable && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => fileRef.current?.click()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: C.textMuted, cursor: "pointer", fontFamily: "inherit" }}>{uploading ? "Uploading…" : "📁 Upload"}</button>
            <button onClick={startCamera} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: C.textMuted, cursor: "pointer", fontFamily: "inherit" }}>📷 Camera</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} style={{ display: "none" }} />
        </div>
      )}
      {showCamera && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 400, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: 320, height: 240, borderRadius: 10, border: `2px solid ${C.border}` }} />
          <div style={{ display: "flex", gap: 12 }}><Btn onClick={capturePhoto} variant="primary">📸 Capture</Btn><Btn onClick={stopCamera} variant="danger">Cancel</Btn></div>
        </div>
      )}
    </div>
  );
}

// ─── Patient Form ─────────────────────────────────────────────────────────────

function PatientFormPanel({ initial, onSave, onCancel, saving, title }: { initial: PatientForm; onSave: (form: PatientForm, photoUrl: string | null) => Promise<void>; onCancel: () => void; saving: boolean; title: string; }) {
  const [form, setForm] = useState<PatientForm>(initial);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const setF = (key: keyof PatientForm, value: string) => setForm(f => ({ ...f, [key]: value }));

  const onHeightFtChange = (v: string) => { setF("height_ft", v); setF("height_cm", String(ftInToCm(parseInt(v) || 0, parseInt(form.height_in) || 0) || "")); };
  const onHeightInChange = (v: string) => { setF("height_in", v); setF("height_cm", String(ftInToCm(parseInt(form.height_ft) || 0, parseInt(v) || 0) || "")); };
  const onHeightCmChange = (v: string) => { setF("height_cm", v); const { ft, inches } = cmToFtIn(parseFloat(v) || 0); setF("height_ft", String(ft)); setF("height_in", String(inches)); };
  const onWeightLbsChange = (v: string) => { setF("weight_lbs", v); setF("weight_kg", String(lbsToKg(parseFloat(v) || 0))); };
  const onWeightKgChange = (v: string) => { setF("weight_kg", v); setF("weight_lbs", String(kgToLbs(parseFloat(v) || 0))); };

  const heightCm = parseFloat(form.height_cm) || 0;
  const weightKg = parseFloat(form.weight_kg) || 0;
  const bmi = heightCm > 0 && weightKg > 0 ? calcBMI(heightCm, weightKg) : null;
  const bmiInfo = bmi ? bmiCategory(bmi) : null;
  const age = form.date_of_birth ? calcAge(form.date_of_birth) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h3>
      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <PatientPhoto photoUrl={photoUrl} name={`${form.first_name} ${form.last_name}`.trim() || "Patient"} size={80} editable onUpload={setPhotoUrl} />
      </div>
      <SectionHeader title="Personal Information" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="First Name"><Input value={form.first_name} onChange={v => setF("first_name", v)} placeholder="Jane" /></Field>
        <Field label="Last Name"><Input value={form.last_name} onChange={v => setF("last_name", v)} placeholder="Smith" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "end" }}>
        <Field label="Date of Birth"><Input type="date" value={form.date_of_birth} onChange={v => setF("date_of_birth", v)} /></Field>
        {age !== null && <div style={{ background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}><div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Age</div><div style={{ fontSize: 28, fontWeight: 700, color: C.blue }}>{age}</div></div>}
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Height</label>
          <UnitToggle value={form.height_unit} options={["cm", "ft"]} onChange={v => setF("height_unit", v as "cm" | "ft")} />
        </div>
        {form.height_unit === "cm" ? <Input type="number" value={form.height_cm} onChange={onHeightCmChange} placeholder="167" min={50} max={250} /> : <div style={{ display: "flex", gap: 8 }}><Input type="number" value={form.height_ft} onChange={onHeightFtChange} placeholder="5" min={1} max={8} style={{ flex: 1 }} /><span style={{ color: C.textMuted, alignSelf: "center" }}>ft</span><Input type="number" value={form.height_in} onChange={onHeightInChange} placeholder="6" min={0} max={11} style={{ flex: 1 }} /><span style={{ color: C.textMuted, alignSelf: "center" }}>in</span></div>}
        {heightCm > 0 && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{form.height_unit === "cm" ? `${cmToFtIn(heightCm).ft}′ ${cmToFtIn(heightCm).inches}″` : `${heightCm} cm`}</div>}
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Weight</label>
          <UnitToggle value={form.weight_unit} options={["kg", "lbs"]} onChange={v => setF("weight_unit", v as "kg" | "lbs")} />
        </div>
        {form.weight_unit === "kg" ? <Input type="number" value={form.weight_kg} onChange={onWeightKgChange} placeholder="64" min={20} max={300} /> : <Input type="number" value={form.weight_lbs} onChange={onWeightLbsChange} placeholder="142" min={44} max={660} />}
        {weightKg > 0 && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{form.weight_unit === "kg" ? `${kgToLbs(weightKg)} lbs` : `${weightKg} kg`}</div>}
      </div>
      {bmi && bmiInfo && <div style={{ display: "flex", alignItems: "center", gap: 16, background: bmiInfo.color + "15", border: `1px solid ${bmiInfo.color}30`, borderRadius: 8, padding: "12px 16px" }}><div><div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>BMI</div><div style={{ fontSize: 28, fontWeight: 700, color: bmiInfo.color }}>{bmi}</div></div><Badge label={bmiInfo.label} color={bmiInfo.color} /></div>}
      <SectionHeader title="Clinical" />
      <Field label="Patient Type"><Select value={form.patient_type} onChange={v => setF("patient_type", v)}><option value="general_fitness">General Fitness</option><option value="post_surgery">Post Surgery</option><option value="senior">Senior / Elderly</option><option value="chronic_pain">Chronic Pain</option></Select></Field>
      <Field label="Condition Notes" hint="Diagnosis, relevant history"><Textarea value={form.condition_notes} onChange={v => setF("condition_notes", v)} rows={3} placeholder="e.g. Rotator cuff repair, 6 weeks post-op" /></Field>
      <Field label="Goals"><Textarea value={form.goals} onChange={v => setF("goals", v)} rows={2} placeholder="e.g. Restore full shoulder range of motion" /></Field>
      <div style={{ display: "flex", gap: 10, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
        <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
        <Btn onClick={() => onSave(form, photoUrl)} variant="primary" disabled={saving} fullWidth>{saving ? "Saving…" : "Save Patient"}</Btn>
      </div>
    </div>
  );
}

// ─── Session Results Drill-down ───────────────────────────────────────────────

function SessionResultsPanel({ prescriptionId, sessionTitle, onClose }: { prescriptionId: string; sessionTitle: string; onClose: () => void; }) {
  const supabase = getSupabaseClient();
  const [result, setResult] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [prescriptionExercises, setPrescriptionExercises] = useState<{ sequence_order: number; display_name: string; }[]>([]);
  const [expandedExIdx, setExpandedExIdx] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const [{ data: res }, { data: blocks }, { data: peOld }] = await Promise.all([
        supabase.from("session_results").select("*, exercise_results(id, sequence_order, reps_prescribed, reps_attempted, reps_successful, reps_failed, hold_compliance_rate, failed_hold_count, failed_height_count, failed_balance_count, failed_isolation_count, avg_metric_degrees, target_metric_degrees, avg_hold_ms, landmark_confidence_pct, movement_timeline)").eq("prescription_id", prescriptionId).order("created_at", { ascending: false }).limit(1).single(),
        supabase.from("session_blocks").select("sequence_order, session_block_exercises(sequence_order, exercise_templates(display_name))").eq("session_id", prescriptionId).order("sequence_order"),
        supabase.from("prescription_exercises").select("sequence_order, exercise_templates(display_name)").eq("prescription_id", prescriptionId).order("sequence_order"),
      ]);
      if (res) setResult(res as SessionResult);
      const blockExercises = (blocks ?? []).flatMap((b: Record<string, unknown>) =>
        ((b.session_block_exercises as Record<string, unknown>[]) ?? []).map(e => ({
          sequence_order: e.sequence_order as number,
          display_name: (e.exercise_templates as { display_name: string } | null)?.display_name ?? "Exercise",
        }))
      );
      const exercises = blockExercises.length > 0
        ? blockExercises
        : (peOld ?? []).map((e: Record<string, unknown>) => ({
            sequence_order: e.sequence_order as number,
            display_name: (e.exercise_templates as { display_name: string } | null)?.display_name ?? "Exercise",
          }));
      setPrescriptionExercises(exercises);
      setLoading(false);
    }
    load();
  }, [prescriptionId, supabase]);

  const score = result?.mobility_score ?? null;
  const scoreColor = score === null ? C.textMuted : score >= 80 ? C.green : score >= 60 ? C.orange : C.red;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300, display: "flex", justifyContent: "flex-end" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(720px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{sessionTitle}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Session Results</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>Loading results…</div>
          ) : !result ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textDim }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div>No results found for this session.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

              {/* ── SUMMARY DASHBOARD ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Mobility score */}
                <div style={{ background: C.bg, border: `1px solid ${scoreColor}40`, borderRadius: 12, padding: "20px", textAlign: "center", gridRow: "span 1" }}>
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 }}>Mobility Score</div>
                  <div style={{ fontSize: 64, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{score ?? "—"}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>out of 100</div>
                </div>
                {/* Session meta */}
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.duration_ms && (
                    <div><div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Duration</div><div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 2 }}>{formatDuration(result.duration_ms)}</div></div>
                  )}
                  {result.completed_at && (
                    <div><div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Completed</div><div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>{formatDate(result.completed_at)}</div></div>
                  )}
                  <div><div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Exercises</div><div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>{result.exercise_results.length}</div></div>
                </div>
              </div>

              {/* ── EXERCISE BREAKDOWN ── */}
              <div>
                <SectionHeader title="Exercise Breakdown" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.exercise_results.sort((a, b) => a.sequence_order - b.sequence_order).map((ex, i) => {
                    const exName = prescriptionExercises.find(p => p.sequence_order === ex.sequence_order)?.display_name ?? `Exercise ${i + 1}`;
                    const completionPct = ex.reps_prescribed > 0 ? Math.round(ex.reps_successful / ex.reps_prescribed * 100) : 0;
                    const holdPct = ex.hold_compliance_rate !== null ? Math.round(ex.hold_compliance_rate * 100) : null;
                    const exColor = completionPct >= 80 ? C.green : completionPct >= 60 ? C.orange : C.red;
                    const confColor = ex.landmark_confidence_pct !== null ? (ex.landmark_confidence_pct >= 80 ? C.green : ex.landmark_confidence_pct >= 60 ? C.orange : C.red) : C.textDim;
                    const repTimeline = ex.movement_timeline ?? [];
                    const peaks = repTimeline.filter(r => r.outcome === "success" && r.peakRomDeg !== null).map(r => r.peakRomDeg as number);
                    const isExpanded = expandedExIdx === i;

                    return (
                      <div key={ex.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                        {/* Exercise header row */}
                        <div style={{ padding: "14px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ width: 24, height: 24, borderRadius: "50%", background: exColor + "20", color: exColor, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{exName}</span>
                            </div>
                            <span style={{ fontSize: 18, fontWeight: 700, color: exColor }}>{completionPct}%</span>
                          </div>
                          <div style={{ height: 4, background: C.border, borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${completionPct}%`, background: exColor, borderRadius: 2 }} />
                          </div>

                          {/* Primary metrics grid */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
                            {[
                              { label: "Prescribed", value: ex.reps_prescribed, color: C.textMuted },
                              { label: "Completed", value: ex.reps_successful, color: C.green },
                              { label: "Failed", value: ex.reps_failed, color: ex.reps_failed > 0 ? C.red : C.textDim },
                              { label: "Hold %", value: holdPct !== null ? `${holdPct}%` : "—", color: holdPct !== null && holdPct >= 80 ? C.green : C.orange },
                            ].map(({ label, value, color }) => (
                              <div key={label} style={{ background: C.surface, borderRadius: 6, padding: "8px", textAlign: "center" }}>
                                <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
                                <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{label}</div>
                              </div>
                            ))}
                          </div>

                          {/* ROM + Hold metrics row */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
                            <div style={{ background: C.surface, borderRadius: 6, padding: "8px", textAlign: "center" }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: C.blue }}>{ex.avg_metric_degrees !== null ? `${Math.round(ex.avg_metric_degrees)}°` : "—"}</div>
                              <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Avg ROM</div>
                              {ex.target_metric_degrees !== null && <div style={{ fontSize: 10, color: C.orange, marginTop: 2 }}>target {Math.round(ex.target_metric_degrees)}°</div>}
                            </div>
                            <div style={{ background: C.surface, borderRadius: 6, padding: "8px", textAlign: "center" }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: ex.avg_metric_degrees !== null && ex.target_metric_degrees !== null ? (ex.avg_metric_degrees >= ex.target_metric_degrees ? C.green : C.red) : C.textMuted }}>
                                {ex.avg_metric_degrees !== null && ex.target_metric_degrees !== null ? `${ex.avg_metric_degrees >= ex.target_metric_degrees ? "+" : ""}${Math.round(ex.avg_metric_degrees - ex.target_metric_degrees)}°` : "—"}
                              </div>
                              <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>vs Target</div>
                            </div>
                            <div style={{ background: C.surface, borderRadius: 6, padding: "8px", textAlign: "center" }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: confColor }}>{ex.landmark_confidence_pct !== null ? `${ex.landmark_confidence_pct}%` : "—"}</div>
                              <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Confidence</div>
                            </div>
                          </div>

                          {/* Failure tags */}
                          {(ex.failed_height_count > 0 || ex.failed_hold_count > 0 || ex.failed_balance_count > 0 || ex.failed_isolation_count > 0) && (
                            <div style={{ marginBottom: 10, padding: "8px 12px", background: C.redDim, border: `1px solid ${C.red}20`, borderRadius: 6, fontSize: 12 }}>
                              <span style={{ color: C.textMuted, marginRight: 8 }}>Failures:</span>
                              {ex.failed_height_count > 0 && <span style={{ color: C.red, marginRight: 8 }}>Height ×{ex.failed_height_count}</span>}
                              {ex.failed_hold_count > 0 && <span style={{ color: C.orange, marginRight: 8 }}>Hold ×{ex.failed_hold_count}</span>}
                              {ex.failed_balance_count > 0 && <span style={{ color: C.purple, marginRight: 8 }}>Balance ×{ex.failed_balance_count}</span>}
                              {ex.failed_isolation_count > 0 && <span style={{ color: C.blue }}>Isolation ×{ex.failed_isolation_count}</span>}
                            </div>
                          )}

                          {/* Expand toggle */}
                          {repTimeline.length > 0 && (
                            <button
                              onClick={() => setExpandedExIdx(isExpanded ? null : i)}
                              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 12px", color: C.textMuted, fontSize: 11, cursor: "pointer", fontFamily: "inherit", width: "100%" }}
                            >
                              {isExpanded ? "▲ Hide per-rep breakdown" : `▼ Show ${repTimeline.length} reps`}
                            </button>
                          )}
                        </div>

                        {/* Per-rep breakdown — expanded */}
                        {isExpanded && repTimeline.length > 0 && (
                          <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 16px", background: "rgba(0,0,0,0.2)" }}>
                            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", fontWeight: 700, marginBottom: 10 }}>Per-Rep Detail</div>
                            <div style={{ overflowX: "auto" as const }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 12 }}>
                                <thead>
                                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                                    {["Rep", "Outcome", "Peak ROM", "vs Target", "Hold", "Note"].map(h => (
                                      <th key={h} style={{ padding: "5px 10px", textAlign: "left" as const, fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", whiteSpace: "nowrap" as const }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {repTimeline.map((rep, ri) => {
                                    const isSuccess = rep.outcome === "success";
                                    const vsTarget = rep.peakRomDeg !== null && ex.target_metric_degrees !== null
                                      ? rep.peakRomDeg - ex.target_metric_degrees : null;
                                    return (
                                      <tr key={ri} style={{ borderBottom: `1px solid ${C.border}20` }}>
                                        <td style={{ padding: "6px 10px", color: C.textMuted, fontWeight: 600 }}>{rep.rep}</td>
                                        <td style={{ padding: "6px 10px", color: isSuccess ? C.green : C.red, fontWeight: 600 }}>{isSuccess ? "✓" : "✗"}</td>
                                        <td style={{ padding: "6px 10px", color: isSuccess ? C.blue : C.textMuted, fontWeight: 600 }}>{rep.peakRomDeg !== null ? `${rep.peakRomDeg.toFixed(1)}°` : "—"}</td>
                                        <td style={{ padding: "6px 10px", color: vsTarget === null ? C.textDim : vsTarget >= 0 ? C.green : C.red, fontWeight: 600 }}>
                                          {vsTarget !== null ? `${vsTarget >= 0 ? "+" : ""}${vsTarget.toFixed(0)}°` : "—"}
                                        </td>
                                        <td style={{ padding: "6px 10px", color: rep.holdMs !== null ? C.text : C.textDim }}>
                                          {rep.holdMs !== null ? `${(rep.holdMs / 1000).toFixed(1)}s` : "—"}
                                        </td>
                                        <td style={{ padding: "6px 10px", color: C.textMuted, fontSize: 11 }}>
                                          {!isSuccess && rep.failureReason ? rep.failureReason.replace(/_/g, " ") : ""}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {/* ROM sparkline — simple inline bars */}
                            {peaks.length >= 2 && (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 6 }}>ROM Trend</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 36 }}>
                                  {peaks.map((p, pi) => {
                                    const maxP = Math.max(...peaks);
                                    const minP = Math.min(...peaks);
                                    const range = maxP - minP || 1;
                                    const h = Math.max(8, Math.round(((p - minP) / range) * 28 + 8));
                                    const aboveTarget = ex.target_metric_degrees !== null && p >= ex.target_metric_degrees;
                                    return (
                                      <div key={pi} title={`Rep ${pi + 1}: ${p.toFixed(1)}°`} style={{ flex: 1, height: h, borderRadius: 2, background: aboveTarget ? C.green : C.orange, minWidth: 8, cursor: "default" }} />
                                    );
                                  })}
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textDim, marginTop: 4 }}>
                                  <span>Rep 1</span><span>Rep {peaks.length}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── CLINICAL SUMMARY ── */}
              {result.claude_summary && (
                <div>
                  <SectionHeader title="Clinical Summary" />
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", fontSize: 13, color: C.text, lineHeight: 1.8, whiteSpace: "pre-wrap" as const }}>{result.claude_summary}</div>
                </div>
              )}

              {/* ── COPY TO CLIPBOARD ── */}
              <Btn onClick={() => {
                const lines = [
                  `Session: ${sessionTitle}`,
                  `Date: ${result.completed_at ? formatDate(result.completed_at) : "—"}`,
                  `Mobility Score: ${score ?? "—"}/100`,
                  `Duration: ${result.duration_ms ? formatDuration(result.duration_ms) : "—"}`,
                  "", "Exercise Results:",
                  ...result.exercise_results.sort((a, b) => a.sequence_order - b.sequence_order).map((ex, i) => {
                    const name = prescriptionExercises.find(p => p.sequence_order === ex.sequence_order)?.display_name ?? `Exercise ${i + 1}`;
                    const repLines = (ex.movement_timeline ?? []).map(r =>
                      `    Rep ${r.rep}: ${r.outcome} peak=${r.peakRomDeg?.toFixed(1) ?? "n/a"}° hold=${r.holdMs !== null ? (r.holdMs/1000).toFixed(1) + "s" : "n/a"}${r.failureReason ? " (" + r.failureReason + ")" : ""}`
                    ).join("\n");
                    return `  ${i + 1}. ${name}: ${ex.reps_successful}/${ex.reps_prescribed} reps | avg ROM ${ex.avg_metric_degrees !== null ? Math.round(ex.avg_metric_degrees) + "°" : "n/a"} | target ${ex.target_metric_degrees !== null ? Math.round(ex.target_metric_degrees) + "°" : "n/a"}\n${repLines}`;
                  }),
                  result.claude_summary ? `\nClinical Summary:\n${result.claude_summary}` : "",
                ].join("\n");
                navigator.clipboard.writeText(lines);
              }} variant="ghost">📋 Copy Full Report</Btn>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Assign Protocol Flow ─────────────────────────────────────────────────────

function AssignSessionPanel({ patient, templates, onAssign, onCancel }: { patient: Patient; templates: SessionTemplate[]; onAssign: () => void; onCancel: () => void; }) {
  const supabase = getSupabaseClient();
  const [step, setStep] = useState<"pick" | "override">("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<SessionTemplate | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<{ reps: number; hold_ms: number; note: string; rom_target: number | null; rom_encourage: number | null; }[]>([]);
  const [saving, setSaving] = useState(false);

  const filteredTemplates = templates.filter(t => {
    const matchSearch = search === "" || t.title.toLowerCase().includes(search.toLowerCase());
    const matchTag = tagFilter === "" || t.tags.includes(tagFilter);
    return matchSearch && matchTag;
  });

  const selectTemplate = (t: SessionTemplate) => {
    setSelectedTemplate(t);
    setOverrides(t.exercises.map(ex => ({
      reps: ex.default_reps ?? ex.exercise_template?.default_reps ?? 6,
      hold_ms: ex.default_hold_ms ?? ex.exercise_template?.default_hold_ms ?? 2000,
      note: "",
      rom_target: ex.exercise_template?.rom_acceptable_min ?? null,
      rom_encourage: null,
    })));
    setStep("override");
  };

  const assign = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      const { data: session, error: sErr } = await supabase
        .from("sessions").insert({ title: selectedTemplate.title, objective: selectedTemplate.objective, patient_id: patient.id, physio_id: null, estimated_duration_mins: selectedTemplate.estimated_duration_mins, status: "pending", source_protocol_id: selectedTemplate.id }).select().single();
      if (sErr) throw sErr;
      const { data: block, error: bErr } = await supabase.from("session_blocks").insert({ session_id: session.id, protocol_id: selectedTemplate.id, sequence_order: 0, rest_before_ms: 0 }).select().single();
      if (bErr) throw bErr;
      const { error: eErr } = await supabase.from("session_block_exercises").insert(
        selectedTemplate.exercises.map((ex, i) => ({ session_block_id: block.id, exercise_template_id: ex.exercise_template_id, sequence_order: i, reps_override: overrides[i]?.reps ?? null, hold_ms_override: overrides[i]?.hold_ms ?? null, coaching_notes: overrides[i]?.note || null, rom_target_degrees: overrides[i]?.rom_target ?? null, rom_encourage_degrees: overrides[i]?.rom_encourage ?? null }))
      );
      if (eErr) throw eErr;
      onAssign();
    } catch (err) { console.error("Assign failed:", err); }
    finally { setSaving(false); }
  };

  const allTags = Array.from(new Set(templates.flatMap(t => t.tags))).sort();

  if (step === "pick") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Assign Protocol to {patient.full_name}</div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 18, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {filteredTemplates.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: C.textDim, fontSize: 13 }}>No templates match your filter.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
          {filteredTemplates.map(t => (
            <div key={t.id} onClick={() => selectTemplate(t)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer" }} onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus)} onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{t.title}</div>
                <span style={{ fontSize: 11, color: C.textDim, whiteSpace: "nowrap" as const }}>{t.exercises.length} ex · {t.estimated_duration_mins}min</span>
              </div>
              {t.objective && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>{t.objective}</div>}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                {t.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: C.blueDim, color: C.blue, fontWeight: 600 }}>{tag}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setStep("pick")} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 13, padding: 0 }}>← Back</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{selectedTemplate?.title}</div>
      </div>
      <div style={{ fontSize: 12, color: C.textMuted }}>Adjust reps, hold duration, and ROM targets per exercise for {patient.full_name}.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto" }}>
        {selectedTemplate?.exercises.sort((a, b) => a.sequence_order - b.sequence_order).map((ex, i) => {
          const romStart = ex.exercise_template?.rom_start_degrees ?? 0;
          const romNorm = ex.exercise_template?.rom_norm_degrees ?? null;
          const romMax = ex.exercise_template?.rom_max_degrees ?? romNorm ?? 180;
          const romMin = ex.exercise_template?.rom_acceptable_min ?? null;
          const hasRom = romNorm !== null;
          const currentTarget = overrides[i]?.rom_target ?? romMin ?? romNorm ?? null;
          const currentEncourage = overrides[i]?.rom_encourage ?? null;
          return (
            <div key={ex.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>{i + 1}. {ex.exercise_template?.display_name}</div>
              <div style={{ display: "flex", gap: 12, marginBottom: hasRom ? 12 : 0 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Reps</label>
                  <input type="number" value={overrides[i]?.reps ?? 6} min={1} max={30} onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, reps: parseInt(e.target.value) || 1 } : o))} style={{ width: "100%", marginTop: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 8px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Hold (s)</label>
                  <input type="number" value={msToSeconds(overrides[i]?.hold_ms ?? 2000)} min={0} max={10} step={0.5} onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, hold_ms: secondsToMs(e.target.value) } : o))} style={{ width: "100%", marginTop: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 8px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Clinical Note</label>
                  <input value={overrides[i]?.note ?? ""} placeholder="Optional note…" onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, note: e.target.value } : o))} style={{ width: "100%", marginTop: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 8px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                </div>
              </div>
              {hasRom && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <label style={{ fontSize: 11, color: C.orange, textTransform: "uppercase" as const, letterSpacing: "0.04em", fontWeight: 600 }}>Expected ROM — hold fires here</label>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>{currentTarget ?? "—"}°</span>
                    </div>
                    <input type="range" min={romStart} max={romNorm ?? romMax} step={5} value={currentTarget ?? (romMin ?? romNorm ?? romStart)} onChange={e => { const val = parseInt(e.target.value); setOverrides(prev => prev.map((o, j) => { if (j !== i) return o; const newEncourage = o.rom_encourage !== null && o.rom_encourage <= val ? null : o.rom_encourage; return { ...o, rom_target: val, rom_encourage: newEncourage }; })); }} style={{ width: "100%", accentColor: C.orange, cursor: "pointer" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textDim, marginTop: 2 }}>
                      <span>{romStart}° (rest)</span>
                      {romNorm !== null && <span>norm {romNorm}°</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <label style={{ fontSize: 11, color: C.green, textTransform: "uppercase" as const, letterSpacing: "0.04em", fontWeight: 600 }}>Encourage-to ROM</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: currentEncourage !== null ? C.green : C.textDim }}>{currentEncourage !== null ? `${currentEncourage}°` : "Not set"}</span>
                        {currentEncourage !== null && <button onClick={() => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, rom_encourage: null } : o))} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 11, padding: "0 2px", fontFamily: "inherit" }}>clear</button>}
                      </div>
                    </div>
                    <input type="range" min={currentTarget ?? romMin ?? romStart} max={romMax} step={5} value={currentEncourage ?? (currentTarget !== null ? Math.min((currentTarget ?? 0) + 10, romMax) : romMax)} onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, rom_encourage: parseInt(e.target.value) } : o))} style={{ width: "100%", accentColor: C.green, cursor: "pointer", opacity: currentEncourage !== null ? 1 : 0.4 }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Btn onClick={assign} variant="primary" disabled={saving} fullWidth>{saving ? "Assigning…" : `Assign Protocol to ${patient.full_name}`}</Btn>
    </div>
  );
}

// ─── Patient Profile Panel ────────────────────────────────────────────────────

function PatientProfilePanel({ patient, prescriptions, templates, onClose, onEdit, onDelete, onRefresh }: { patient: Patient; prescriptions: PrescribedSession[]; templates: SessionTemplate[]; onClose: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void; }) {
  const supabase = getSupabaseClient();
  const age = patient.date_of_birth ? calcAge(patient.date_of_birth) : null;
  const bmi = patient.height_cm && patient.weight_kg ? calcBMI(patient.height_cm, patient.weight_kg) : null;
  const bmiInfo = bmi ? bmiCategory(bmi) : null;
  const patientSessions = prescriptions.filter(s => s.patient_id === patient.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const completedSessions = patientSessions.filter(s => s.status === "completed");
  const pendingSessions   = patientSessions.filter(s => s.status === "pending");

  const [assigning, setAssigning] = useState(false);
  const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
  const [viewingResultsTitle, setViewingResultsTitle] = useState<string>("");
  const [sessionFilter, setSessionFilter] = useState<"all" | "pending" | "completed">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredSessions = sessionFilter === "pending" ? pendingSessions : sessionFilter === "completed" ? completedSessions : patientSessions;

  const handleDeleteSession = async (sessionId: string, title: string) => {
    if (!confirm(`Delete session "${title}"? This cannot be undone.`)) return;
    setDeletingId(sessionId);
    try {
      const { data: blocks } = await supabase.from("session_blocks").select("id").eq("session_id", sessionId);
      if (blocks && blocks.length > 0) {
        const blockIds = blocks.map((b: { id: string }) => b.id);
        await supabase.from("session_block_exercises").delete().in("session_block_id", blockIds);
        await supabase.from("session_blocks").delete().eq("session_id", sessionId);
      }
      const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
      if (error) throw error;
      onRefresh();
    } catch (err: unknown) { alert(err instanceof Error ? err.message : "Delete failed"); }
    finally { setDeletingId(null); }
  };

  const filterBtnStyle = (active: boolean) => ({ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer" as const, border: "none", background: active ? C.blue + "22" : "transparent", color: active ? C.blue : C.textMuted, outline: active ? `1px solid ${C.blue}44` : "1px solid transparent" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", justifyContent: "flex-end" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(600px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <PatientPhoto photoUrl={patient.photo_url} name={patient.full_name} size={56} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{patient.full_name}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" as const }}>
              <Badge label={PATIENT_TYPE_LABELS[patient.patient_type] ?? patient.patient_type} color={PATIENT_TYPE_COLORS[patient.patient_type] ?? C.blue} />
              {age !== null && <Badge label={`Age ${age}`} color={C.textMuted} />}
              {bmi && bmiInfo && <Badge label={`BMI ${bmi}`} color={bmiInfo.color} />}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn onClick={onEdit} small>Edit</Btn>
            <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {[{ label: "Total", value: patientSessions.length }, { label: "Completed", value: completedSessions.length, color: C.green }, { label: "Pending", value: pendingSessions.length, color: C.blue }, { label: "Rate", value: patientSessions.length > 0 ? `${Math.round(completedSessions.length / patientSessions.length * 100)}%` : "—", color: C.blue }].map(({ label, value, color }) => (
            <div key={label} style={{ padding: "12px 16px", textAlign: "center", background: C.bg }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: color ?? C.text }}>{value}</div>
              <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {assigning ? (
            <AssignSessionPanel patient={patient} templates={templates} onAssign={() => { setAssigning(false); onRefresh(); }} onCancel={() => setAssigning(false)} />
          ) : (
            <>
              {(patient.condition_notes || patient.goals) && (
                <div style={{ marginBottom: 20, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px" }}>
                  {patient.condition_notes && <div style={{ marginBottom: patient.goals ? 10 : 0 }}><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 4 }}>Condition</div><div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{patient.condition_notes}</div></div>}
                  {patient.goals && <div><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 4 }}>Goals</div><div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{patient.goals}</div></div>}
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Sessions</div>
                  <Btn onClick={() => setAssigning(true)} variant="primary" small>+ Assign Protocol</Btn>
                </div>
                {patientSessions.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginBottom: 14, background: C.bg, borderRadius: 24, padding: 4, width: "fit-content", border: `1px solid ${C.border}` }}>
                    {(["all", "pending", "completed"] as const).map(f => (
                      <button key={f} onClick={() => setSessionFilter(f)} style={filterBtnStyle(sessionFilter === f)}>
                        {f === "all" ? `All (${patientSessions.length})` : f === "pending" ? `Pending (${pendingSessions.length})` : `Completed (${completedSessions.length})`}
                      </button>
                    ))}
                  </div>
                )}
                {filteredSessions.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.textDim, padding: "24px 0", textAlign: "center" }}>{patientSessions.length === 0 ? "No sessions assigned yet." : `No ${sessionFilter} sessions.`}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {filteredSessions.map(s => (
                      <div key={s.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.title}</div>
                            <div style={{ fontSize: 11, color: C.textDim }}>{s.exercises.length} exercise{s.exercises.length !== 1 ? "s" : ""} · {s.estimated_duration_mins} min · Created {formatDate(s.created_at)}</div>
                          </div>
                          <Badge label={s.status === "completed" ? "Completed" : s.status === "pending" ? "Pending" : s.status} color={s.status === "completed" ? C.green : s.status === "pending" ? C.blue : C.textMuted} />
                        </div>
                        {s.exercises.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, marginBottom: 10 }}>
                            {s.exercises.slice(0, 4).map((ex, i) => <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>{ex.display_name}</span>)}
                            {s.exercises.length > 4 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>+{s.exercises.length - 4} more</span>}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <Btn onClick={() => window.open(`/session?prescription=${s.id}`, "_blank")} small>{s.status === "completed" ? "↺ Re-run" : "▶ Run Session"}</Btn>
                          {s.status === "completed" && <Btn onClick={() => { setViewingResultsId(s.id); setViewingResultsTitle(s.title); }} small variant="ghost">📊 Results</Btn>}
                          {s.status === "pending" && <button onClick={() => handleDeleteSession(s.id, s.title)} disabled={deletingId === s.id} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: deletingId === s.id ? "not-allowed" : "pointer", background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", opacity: deletingId === s.id ? 0.5 : 1 }}>{deletingId === s.id ? "Deleting…" : "🗑 Delete"}</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {!assigning && (
          <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn onClick={onEdit} variant="primary">Edit Profile</Btn>
            <Btn onClick={onDelete} variant="danger">Delete Patient</Btn>
          </div>
        )}
      </div>
      {viewingResultsId && <SessionResultsPanel prescriptionId={viewingResultsId} sessionTitle={viewingResultsTitle} onClose={() => setViewingResultsId(null)} />}
    </div>
  );
}

// ─── Patients Tab ─────────────────────────────────────────────────────────────

function PatientsTab({ showToast, prescriptions, templates, onRefresh }: { showToast: (msg: string, ok?: boolean) => void; prescriptions: PrescribedSession[]; templates: SessionTemplate[]; onRefresh: () => void; }) {
  const supabase = getSupabaseClient();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [saving, setSaving] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [viewingPatient, setViewingPatient] = useState<Patient | null>(null);
  const [editForm, setEditForm] = useState<PatientForm>(emptyForm());

  const loadPatients = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("patients").select("*").order("created_at", { ascending: false });
    if (data) setPatients(data.map((p: Record<string, unknown>) => ({ id: p.id as string, first_name: (p.first_name as string) ?? "", last_name: (p.last_name as string) ?? "", full_name: (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || (p.full_name as string)) ?? "Unknown", patient_type: p.patient_type as string, condition_notes: p.condition_notes as string | null, goals: p.goals as string | null, date_of_birth: p.date_of_birth as string | null, height_cm: p.height_cm as number | null, weight_kg: p.weight_kg as number | null, photo_url: p.photo_url as string | null, created_at: p.created_at as string })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  const handleSave = async (form: PatientForm, photoUrl: string | null) => {
    if (!form.first_name.trim()) { showToast("First name is required.", false); return; }
    setSaving(true);
    try {
      const payload = { first_name: form.first_name.trim(), last_name: form.last_name.trim(), full_name: `${form.first_name.trim()} ${form.last_name.trim()}`.trim(), patient_type: form.patient_type, date_of_birth: form.date_of_birth || null, condition_notes: form.condition_notes || null, goals: form.goals || null, height_cm: parseFloat(form.height_cm) || null, weight_kg: parseFloat(form.weight_kg) || null, photo_url: photoUrl ?? (mode === "edit" ? selectedPatient?.photo_url : null), consent_given_at: new Date().toISOString() };
      if (mode === "edit" && selectedPatient) {
        const { error } = await supabase.from("patients").update(payload).eq("id", selectedPatient.id);
        if (error) throw error; showToast("Patient updated.");
      } else {
        const { error } = await supabase.from("patients").insert(payload);
        if (error) throw error; showToast(`Patient "${payload.full_name}" registered.`);
      }
      setMode("list"); setSelectedPatient(null); loadPatients();
    } catch (err: unknown) { showToast(err instanceof Error ? err.message : "Failed.", false); }
    finally { setSaving(false); }
  };

  const startEdit = (p: Patient) => {
    const ftIn = p.height_cm ? cmToFtIn(p.height_cm) : { ft: 0, inches: 0 };
    setEditForm({ first_name: p.first_name, last_name: p.last_name, date_of_birth: p.date_of_birth ?? "", patient_type: p.patient_type, condition_notes: p.condition_notes ?? "", goals: p.goals ?? "", height_cm: p.height_cm ? String(p.height_cm) : "", weight_kg: p.weight_kg ? String(p.weight_kg) : "", height_ft: String(ftIn.ft), height_in: String(ftIn.inches), weight_lbs: p.weight_kg ? String(kgToLbs(p.weight_kg)) : "", height_unit: "cm", weight_unit: "kg" });
    setSelectedPatient(p); setViewingPatient(null); setMode("edit");
  };

  const handleDelete = async (p: Patient) => {
    if (!confirm(`Delete patient "${p.full_name}"?`)) return;
    await supabase.from("patients").delete().eq("id", p.id);
    showToast("Patient deleted."); setViewingPatient(null); loadPatients();
  };

  return (
    <div>
      {mode === "list" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div><h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Patients</h2><p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>{patients.length} registered</p></div>
            <Btn variant="primary" onClick={() => { setMode("create"); setEditForm(emptyForm()); }}>+ Register Patient</Btn>
          </div>
          {loading ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted }}>Loading…</div> : patients.length === 0 ? (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 12 }}>👤</div><div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>No patients yet</div></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
              {patients.map(p => {
                const age = p.date_of_birth ? calcAge(p.date_of_birth) : null;
                const bmi = p.height_cm && p.weight_kg ? calcBMI(p.height_cm, p.weight_kg) : null;
                const bmiInfo = bmi ? bmiCategory(bmi) : null;
                const ps = prescriptions.filter(s => s.patient_id === p.id);
                return (
                  <div key={p.id} onClick={() => setViewingPatient(p)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", cursor: "pointer", transition: "border-color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus + "60")} onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
                    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <PatientPhoto photoUrl={p.photo_url} name={p.full_name} size={52} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>{p.full_name}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
                          <Badge label={PATIENT_TYPE_LABELS[p.patient_type] ?? p.patient_type} color={PATIENT_TYPE_COLORS[p.patient_type] ?? C.blue} />
                          {age !== null && <Badge label={`Age ${age}`} color={C.textMuted} />}
                          {bmiInfo && <Badge label={`BMI ${bmi}`} color={bmiInfo.color} />}
                        </div>
                        {p.condition_notes && <div style={{ fontSize: 12, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.condition_notes}</div>}
                        <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>{ps.length} session{ps.length !== 1 ? "s" : ""}{ps.length > 0 && ` · ${ps.filter(s => s.status === "completed").length} completed`}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {(mode === "create" || mode === "edit") && (
        <div style={{ maxWidth: 560 }}>
          <PatientFormPanel initial={editForm} onSave={handleSave} onCancel={() => { setMode("list"); setSelectedPatient(null); }} saving={saving} title={mode === "create" ? "Register New Patient" : `Edit — ${selectedPatient?.full_name}`} />
        </div>
      )}
      {viewingPatient && (
        <PatientProfilePanel patient={viewingPatient} prescriptions={prescriptions} templates={templates} onClose={() => setViewingPatient(null)} onEdit={() => startEdit(viewingPatient)} onDelete={() => handleDelete(viewingPatient)} onRefresh={() => { onRefresh(); }} />
      )}
    </div>
  );
}

// ─── Sessions Tab → Template Builder ─────────────────────────────────────────

function SessionTemplatesTab({ showToast }: { showToast: (msg: string, ok?: boolean) => void; }) {
  const supabase = getSupabaseClient();
  const [exerciseTemplates, setExerciseTemplates] = useState<ExerciseTemplate[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SessionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("New Protocol");
  const [objective, setObjective] = useState("");
  const [estimatedMins, setEstimatedMins] = useState("10");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [exercises, setExercises] = useState<{ template_id: string; clinical_name: string; display_name: string; reps: number; hold_ms: number; }[]>([]);
  const [selectedExTemplateId, setSelectedExTemplateId] = useState("");
  const [search, setSearch] = useState("");
  const [editingProtocolId, setEditingProtocolId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [expandedProtocolId, setExpandedProtocolId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: et }, { data: st }] = await Promise.all([
      supabase.from("exercise_templates").select("*").order("display_name"),
      supabase.from("protocols").select("*, protocol_exercises(*, exercise_templates(id, slug, clinical_name, display_name, default_reps, default_hold_ms, rom_start_degrees, rom_norm_degrees, rom_max_degrees, rom_acceptable_min))").order("created_at", { ascending: false }),
    ]);
    if (et) { setExerciseTemplates(et); if (et.length > 0) setSelectedExTemplateId(et[0].id); }
    if (st) setSavedTemplates(st.map((t: Record<string, unknown>) => ({
      id: t.id as string, title: t.title as string, objective: t.objective as string | null,
      estimated_duration_mins: t.estimated_duration_mins as number, tags: (t.tags as string[]) ?? [],
      created_at: t.created_at as string,
      exercises: ((t.protocol_exercises as Record<string, unknown>[]) ?? []).sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number)).map(e => ({
        id: e.id as string, template_id: e.template_id as string, exercise_template_id: e.exercise_template_id as string,
        sequence_order: e.sequence_order as number, default_reps: e.default_reps as number | null, default_hold_ms: e.default_hold_ms as number | null,
        exercise_template: e.exercise_templates as SessionTemplateExercise["exercise_template"],
      })),
    })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const addExercise = () => {
    const et = exerciseTemplates.find(t => t.id === selectedExTemplateId);
    if (!et) return;
    setExercises(prev => [...prev, { template_id: et.id, clinical_name: et.clinical_name ?? et.display_name, display_name: et.display_name, reps: et.default_reps, hold_ms: et.default_hold_ms }]);
  };
  const removeExercise = (idx: number) => setExercises(prev => prev.filter((_, i) => i !== idx));
  const moveExercise = (idx: number, dir: -1 | 1) => {
    const arr = [...exercises]; const swap = idx + dir;
    if (swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setExercises(arr);
  };
  const addTag = (tag: string) => { const t = tag.trim().toLowerCase(); if (t && !tags.includes(t)) setTags(prev => [...prev, t]); setTagInput(""); };
  const removeTag = (tag: string) => setTags(prev => prev.filter(t => t !== tag));

  const editProtocol = (t: SessionTemplate) => {
    setEditingProtocolId(t.id); setTitle(t.title); setObjective(t.objective ?? ""); setEstimatedMins(String(t.estimated_duration_mins)); setTags([...t.tags]);
    setExercises(t.exercises.map(ex => ({ template_id: ex.exercise_template_id, clinical_name: (ex.exercise_template as any)?.clinical_name ?? ex.exercise_template?.display_name ?? "Unknown", display_name: ex.exercise_template?.display_name ?? "Unknown", reps: ex.default_reps ?? ex.exercise_template?.default_reps ?? 6, hold_ms: ex.default_hold_ms ?? ex.exercise_template?.default_hold_ms ?? 2000 })));
    setBuilderOpen(true);
  };

  const openNewProtocol = () => { setEditingProtocolId(null); setTitle("New Protocol"); setObjective(""); setEstimatedMins("10"); setTags([]); setExercises([]); setBuilderOpen(true); };
  const cancelEdit = () => { setEditingProtocolId(null); setBuilderOpen(false); setTitle("New Protocol"); setObjective(""); setEstimatedMins("10"); setTags([]); setExercises([]); };

  const saveTemplate = async () => {
    if (!title.trim()) { showToast("Title is required.", false); return; }
    if (exercises.length === 0) { showToast("Add at least one exercise.", false); return; }
    setSaving(true);
    try {
      if (editingProtocolId) {
        const { error: tErr } = await supabase.from("protocols").update({ title: title.trim(), objective: objective || null, estimated_duration_mins: parseInt(estimatedMins) || 10, tags }).eq("id", editingProtocolId);
        if (tErr) throw tErr;
        await supabase.from("protocol_exercises").delete().eq("protocol_id", editingProtocolId);
        const { error: eErr } = await supabase.from("protocol_exercises").insert(exercises.map((e, i) => ({ protocol_id: editingProtocolId, exercise_template_id: e.template_id, sequence_order: i, default_reps: e.reps, default_hold_ms: e.hold_ms })));
        if (eErr) throw eErr;
        showToast("Protocol updated."); setEditingProtocolId(null); setBuilderOpen(false);
      } else {
        const { data: tmpl, error: tErr } = await supabase.from("protocols").insert({ title: title.trim(), objective: objective || null, estimated_duration_mins: parseInt(estimatedMins) || 10, tags }).select().single();
        if (tErr) throw tErr;
        const { error: eErr } = await supabase.from("protocol_exercises").insert(exercises.map((e, i) => ({ protocol_id: tmpl.id, exercise_template_id: e.template_id, sequence_order: i, default_reps: e.reps, default_hold_ms: e.hold_ms })));
        if (eErr) throw eErr;
        showToast("Protocol saved."); setBuilderOpen(false);
      }
      setTitle("New Protocol"); setObjective(""); setEstimatedMins("10"); setTags([]); setExercises([]);
      loadData();
    } catch (err: unknown) { showToast(err instanceof Error ? err.message : "Failed.", false); }
    finally { setSaving(false); }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this protocol?")) return;
    await supabase.from("protocol_exercises").delete().eq("protocol_id", id);
    await supabase.from("protocols").delete().eq("id", id);
    showToast("Protocol deleted."); loadData();
  };

  const allTags = Array.from(new Set(savedTemplates.flatMap(t => t.tags))).sort();
  const [tagFilter, setTagFilter] = useState("");
  const filteredTemplates = savedTemplates.filter(t => {
    const ms = search === "" || t.title.toLowerCase().includes(search.toLowerCase());
    const mt = tagFilter === "" || t.tags.includes(tagFilter);
    return ms && mt;
  });

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Protocol Library</h2>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>{savedTemplates.length} protocol{savedTemplates.length !== 1 ? "s" : ""} · Assign to patients from their profile</p>
        </div>
        <Btn variant="primary" onClick={openNewProtocol}>+ New Protocol</Btn>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search protocols…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {filteredTemplates.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "64px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 6 }}>No protocols yet</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>Build your first clinical protocol to assign to patients.</div>
          <Btn variant="primary" onClick={openNewProtocol}>+ Build First Protocol</Btn>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {filteredTemplates.map(t => {
            const isExpanded = expandedProtocolId === t.id;
            const visibleExercises = isExpanded ? t.exercises : t.exercises.slice(0, 3);
            const hiddenCount = t.exercises.length - 3;
            return (
              <div key={t.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: `3px solid ${C.blue}`, borderRadius: 10, padding: "16px", display: "flex", flexDirection: "column", gap: 12 }} onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 20px ${C.blue}15`)} onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>{t.title}</div>
                    {t.objective && <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.4 }}>{t.objective}</div>}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, whiteSpace: "nowrap" as const, marginTop: 2 }}>{t.estimated_duration_mins}min</div>
                </div>
                {t.tags.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>{t.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: C.blueDim, color: C.blue, fontWeight: 600 }}>{tag}</span>)}</div>}
                <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 }}>{t.exercises.length} exercise{t.exercises.length !== 1 ? "s" : ""}</div>
                  {visibleExercises.map((ex, i) => (
                    <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <span style={{ color: C.textDim, minWidth: 14, fontSize: 11 }}>{i + 1}.</span>
                      <span style={{ flex: 1, color: C.text, fontWeight: 500 }}>{(ex.exercise_template as any)?.clinical_name ?? ex.exercise_template?.display_name}</span>
                      <span style={{ color: C.textDim, fontSize: 11 }}>{ex.default_reps ?? ex.exercise_template?.default_reps}× · {msToSeconds(ex.default_hold_ms ?? ex.exercise_template?.default_hold_ms ?? 0)}s</span>
                    </div>
                  ))}
                  {t.exercises.length > 3 && <button onClick={() => setExpandedProtocolId(isExpanded ? null : t.id)} style={{ marginTop: 4, background: "none", border: "none", color: C.blue, fontSize: 11, fontWeight: 600, cursor: "pointer", textAlign: "left" as const, padding: 0, fontFamily: "inherit" }}>{isExpanded ? "▲ Show less" : `▼ Show ${hiddenCount} more`}</button>}
                </div>
                <div style={{ display: "flex", gap: 8, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
                  <Btn onClick={() => editProtocol(t)} variant="ghost" small>✏️ Edit</Btn>
                  <Btn onClick={() => deleteTemplate(t.id)} variant="danger" small>Delete</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {builderOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", justifyContent: "flex-end" }} onClick={e => { if (e.target === e.currentTarget) cancelEdit(); }}>
          <div style={{ width: "min(640px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{editingProtocolId ? "Edit Protocol" : "New Protocol"}</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{editingProtocolId ? "Update details and exercises, then save." : "Build a reusable clinical protocol."}</div>
              </div>
              <button onClick={cancelEdit} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <SectionHeader title="Protocol Details" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 14 }}>
                <Field label="Protocol Title"><Input value={title} onChange={setTitle} placeholder="Shoulder Mobility A" /></Field>
                <Field label="Duration (mins)"><Input type="number" value={estimatedMins} onChange={setEstimatedMins} min={1} max={120} /></Field>
              </div>
              <Field label="Objective"><Input value={objective} onChange={setObjective} placeholder="e.g. Build shoulder strength and range of motion" /></Field>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const, display: "block", marginBottom: 8 }}>Tags</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
                  {tags.map(tag => <span key={tag} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, background: C.blueDim, border: `1px solid ${C.blue}30`, fontSize: 12, color: C.blue }}>{tag}<button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button></span>)}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); } }} placeholder="Add tag (Enter to add)…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  <Btn onClick={() => addTag(tagInput)} small variant="ghost">Add</Btn>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 8 }}>
                  {SUGGESTED_TAGS.filter(t => !tags.includes(t)).slice(0, 10).map(t => <button key={t} onClick={() => addTag(t)} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 12, padding: "2px 8px", fontSize: 11, color: C.textMuted, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>)}
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <SectionHeader title="Exercises" />
                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  <div style={{ flex: 1 }}><Select value={selectedExTemplateId} onChange={setSelectedExTemplateId}>{exerciseTemplates.map(t => <option key={t.id} value={t.id}>{t.clinical_name ?? t.display_name}{!t.is_vanilla ? " (Custom)" : ""} · {t.default_reps} reps · {msToSeconds(t.default_hold_ms)}s hold</option>)}</Select></div>
                  <Btn onClick={addExercise} variant="primary">+ Add</Btn>
                </div>
                {exercises.length === 0 ? <div style={{ textAlign: "center", padding: "20px 0", color: C.textDim, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>No exercises added yet.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {exercises.map((ex, idx) => (
                      <div key={idx} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <button onClick={() => moveExercise(idx, -1)} disabled={idx === 0} style={{ background: "none", border: "none", color: idx === 0 ? C.textDim : C.textMuted, cursor: idx === 0 ? "default" : "pointer", fontSize: 12, padding: 2 }}>▲</button>
                          <span style={{ fontSize: 11, color: C.textDim, textAlign: "center" as const }}>{idx + 1}</span>
                          <button onClick={() => moveExercise(idx, 1)} disabled={idx === exercises.length - 1} style={{ background: "none", border: "none", color: idx === exercises.length - 1 ? C.textDim : C.textMuted, cursor: idx === exercises.length - 1 ? "default" : "pointer", fontSize: 12, padding: 2 }}>▼</button>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{ex.clinical_name ?? ex.display_name}</div>
                          {ex.clinical_name !== ex.display_name && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Patient: {ex.display_name}</div>}
                          <div style={{ display: "flex", gap: 10 }}>
                            {[["Reps", "reps", ex.reps, 1, 30, 1], ["Hold (s)", "hold_ms", msToSeconds(ex.hold_ms), 0, 10, 0.5]].map(([label, key, val, min, max, step]) => (
                              <div key={String(key)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, color: C.textDim }}>{label}</span>
                                <input type="number" value={val} min={Number(min)} max={Number(max)} step={Number(step)} onChange={e => setExercises(prev => prev.map((ex2, i) => i === idx ? { ...ex2, [key as string]: key === "hold_ms" ? secondsToMs(e.target.value) : parseInt(e.target.value) || 1 } : ex2))} style={{ width: 52, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                              </div>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => removeExercise(idx)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: 4, opacity: 0.7 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, background: C.surface, display: "flex", gap: 10, flexShrink: 0 }}>
              <Btn onClick={cancelEdit} variant="ghost">Cancel</Btn>
              <Btn onClick={saveTemplate} variant="primary" disabled={saving} fullWidth>{saving ? "Saving…" : editingProtocolId ? "💾 Update Protocol" : "💾 Save Protocol"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Exercise Library Tab ─────────────────────────────────────────────────────

function ExerciseLibraryTab({ showToast }: { showToast: (msg: string, ok?: boolean) => void; }) {
  const supabase = getSupabaseClient();
  const [vanillaTemplates, setVanillaTemplates] = useState<ExerciseTemplate[]>([]);
  const [myTemplates, setMyTemplates] = useState<ExerciseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<ExerciseTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [subTab, setSubTab] = useState<"vanilla" | "mine">("vanilla");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "type" | "reps">("type");
  const [groupByType, setGroupByType] = useState(true);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    const [{ data: v }, { data: m }] = await Promise.all([
      supabase.from("exercise_templates").select("*").eq("is_vanilla", true).order("exercise_type").order("display_name"),
      supabase.from("exercise_templates").select("*").eq("is_vanilla", false).order("display_name"),
    ]);
    setVanillaTemplates(v ?? []);
    setMyTemplates(m ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleSave = async (template: ExerciseTemplate) => {
    setSaving(true);
    try {
      if (template.id) {
        const { error } = await supabase.from("exercise_templates").update(template).eq("id", template.id);
        if (error) throw error;
        showToast("Exercise updated.");
      } else {
        const { id: _id, ...insertPayload } = { ...template, is_vanilla: false, created_by: null };
        const { error } = await supabase.from("exercise_templates").insert(insertPayload);
        if (error) throw error;
        showToast("Exercise saved to My Library.");
      }
      setEditingTemplate(null); loadTemplates();
    } catch (err: unknown) { showToast(err instanceof Error ? err.message : "Save failed.", false); }
    finally { setSaving(false); }
  };

  const handleCustomise = (template: ExerciseTemplate) => { setEditingTemplate({ ...template, id: "" }); };

  const handleMediaUpload = async (template: ExerciseTemplate, file: File) => {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${template.id || "new"}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("exercise-media").upload(path, file, { upsert: true });
    if (upErr) { showToast("Upload failed: " + upErr.message, false); return; }
    const { data } = supabase.storage.from("exercise-media").getPublicUrl(path);
    setEditingTemplate(t => t ? { ...t, media_url: data.publicUrl } as any : t);
    showToast("Image uploaded.");
  };

  const raw = subTab === "vanilla" ? vanillaTemplates : myTemplates;

  // Filter
  const filtered = raw.filter(t => {
    const ms = search === "" || t.display_name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? "").toLowerCase().includes(search.toLowerCase());
    const mt = typeFilter === "all" || t.exercise_type === typeFilter;
    return ms && mt;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name") return a.display_name.localeCompare(b.display_name);
    if (sortBy === "reps") return b.default_reps - a.default_reps;
    // "type" — sort by type label then name
    const ta = getTypeMeta(a.exercise_type).label;
    const tb = getTypeMeta(b.exercise_type).label;
    return ta !== tb ? ta.localeCompare(tb) : a.display_name.localeCompare(b.display_name);
  });

  // Group by type (only when sortBy = "type" and groupByType enabled)
  const showGroups = groupByType && sortBy === "type" && typeFilter === "all";
  const typeOrder = ["shoulder_flexion", "shoulder_abduction", "sit_to_stand", "knee_extension", "knee_flexion", "custom"];
  const groups: { type: string; label: string; accent: string; items: ExerciseTemplate[] }[] = showGroups
    ? typeOrder
        .map(type => ({
          type,
          label: getTypeMeta(type).label,
          accent: getTypeMeta(type).accent,
          items: sorted.filter(t => t.exercise_type === type),
        }))
        .filter(g => g.items.length > 0)
    : [{ type: "all", label: "", accent: C.blue, items: sorted }];

  const allExerciseTypes = Array.from(new Set(raw.map(t => t.exercise_type))).sort();

  const ExerciseCard = ({ t }: { t: ExerciseTemplate }) => {
    const meta = getTypeMeta(t.exercise_type);
    return (
      <div
        style={{ background: C.surface, border: `1px solid ${meta.accent}40`, borderTop: `3px solid ${meta.accent}`, borderRadius: 10, padding: "14px 14px 0 14px", display: "flex", flexDirection: "column", gap: 8, transition: "box-shadow 0.15s", overflow: "hidden" }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 20px ${meta.accent}20`)}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: meta.accentDim, border: `1px solid ${meta.accent}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{meta.icon}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{(t as any).clinical_name ?? t.display_name}</div>
              {(t as any).clinical_name && (t as any).clinical_name !== t.display_name && (
                <div style={{ fontSize: 11, color: C.textMuted }}>Patient: {t.display_name}</div>
              )}
            </div>
          </div>
          {t.is_vanilla && <Badge label="System" color={meta.accent} />}
        </div>

        {/* Description */}
        {t.description && <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>{t.description}</div>}

        {/* Tags: position + camera + ROM */}
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
          {(t as any).patient_position && (
            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>
              {(t as any).patient_position === "standing" ? "Standing" : (t as any).patient_position === "seated" ? "Seated" : "Standing / Seated"}
            </span>
          )}
          {(t as any).camera_position && (
            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>
              Camera: {(t as any).camera_position === "front" ? "Front" : (t as any).camera_position === "side" ? "Side" : "Front or Side"}
            </span>
          )}
          {(t as any).rom_norm_degrees != null && (
            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: C.bg, border: `1px solid ${C.border}`, color: meta.accent }}>
              ROM {(t as any).rom_start_degrees ?? 0}° → {(t as any).rom_norm_degrees}°{(t as any).rom_acceptable_min != null ? ` (min ${(t as any).rom_acceptable_min}°)` : ""}
            </span>
          )}
        </div>

        {/* Reps/hold pill */}
        <div style={{ padding: "5px 9px", background: meta.accentDim, borderRadius: 6, display: "inline-flex", alignSelf: "flex-start" }}>
          <span style={{ fontSize: 11, color: meta.accent, fontWeight: 600 }}>{t.default_reps} reps · {msToSeconds(t.default_hold_ms)}s hold</span>
        </div>

        {/* Media image — constrained height, no bleed on mobile */}
        {(t as any).media_url && (
          <div style={{ margin: "4px -14px 0 -14px", lineHeight: 0 }}>
            <img
              src={(t as any).media_url}
              alt={t.display_name}
              style={{ width: "100%", height: 110, objectFit: "contain", objectPosition: "bottom", display: "block", background: "#f5f5f7" }}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, padding: "8px 0", borderTop: `1px solid ${C.border}`, marginTop: (t as any).media_url ? 0 : 4 }}>
          {t.is_vanilla && <Btn onClick={() => handleCustomise(t)} small variant="ghost" fullWidth>Customise →</Btn>}
          <Btn onClick={() => setEditingTemplate({ ...t })} small variant="ghost" fullWidth>Edit</Btn>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* ── Sub-tabs ── */}
      <div style={{ display: "flex", gap: 2, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 16 }}>
        {[{ key: "vanilla", label: `System (${vanillaTemplates.length})` }, { key: "mine", label: `My Library (${myTemplates.length})` }].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key as "vanilla" | "mine")} style={{ background: subTab === key ? C.surfaceHover : "transparent", border: `1px solid ${subTab === key ? C.border : "transparent"}`, borderRadius: 6, padding: "6px 16px", color: subTab === key ? C.text : C.textMuted, fontSize: 13, fontWeight: subTab === key ? 600 : 400, fontFamily: "inherit", cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {/* ── Controls row ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" as const }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search exercises…"
          style={{ flex: "1 1 160px", minWidth: 120, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }}
        />
        <select
          value={typeFilter} onChange={e => { setTypeFilter(e.target.value); if (e.target.value !== "all") setGroupByType(false); else setGroupByType(true); }}
          style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}
        >
          <option value="all">All types</option>
          {allExerciseTypes.map(type => <option key={type} value={type}>{getTypeMeta(type).label}</option>)}
        </select>
        <select
          value={sortBy} onChange={e => setSortBy(e.target.value as "name" | "type" | "reps")}
          style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}
        >
          <option value="type">Group by type</option>
          <option value="name">Sort A–Z</option>
          <option value="reps">Sort by reps</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textDim }}>No exercises match your filter.</div>
      ) : (
        <div>
          {groups.map(group => (
            <div key={group.type}>
              {/* Group header — only shown when grouping is active */}
              {showGroups && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, marginTop: group.type !== groups[0].type ? 28 : 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: group.accent, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{group.label}</span>
                  <span style={{ fontSize: 11, color: C.textDim }}>({group.items.length})</span>
                  <div style={{ flex: 1, height: 1, background: group.accent + "30" }} />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: showGroups ? 4 : 0 }}>
                {group.items.map(t => <ExerciseCard key={t.id} t={t} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Edit / Customise panel ── */}
      {editingTemplate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", justifyContent: "flex-end" }} onClick={e => { if (e.target === e.currentTarget) setEditingTemplate(null); }}>
          <div style={{ width: "min(500px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{editingTemplate.id ? "Edit" : "Customise"}: {(editingTemplate as any).clinical_name ?? editingTemplate.display_name}</h3>
                  {!editingTemplate.id && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Creating a clinic copy — system template will not be changed</div>}
                </div>
                <button onClick={() => setEditingTemplate(null)} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer" }}>✕</button>
              </div>
              <Field label="Display Name"><Input value={editingTemplate.display_name} onChange={v => setEditingTemplate(t => t ? { ...t, display_name: v } : t)} /></Field>
              <Field label="Clinical Name"><Input value={(editingTemplate as any).clinical_name ?? ""} onChange={v => setEditingTemplate(t => t ? { ...t, clinical_name: v } as any : t)} /></Field>
              <Field label="Description"><Textarea value={editingTemplate.description ?? ""} onChange={v => setEditingTemplate(t => t ? { ...t, description: v } : t)} /></Field>
              <Field label="Reference Image / GIF">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(editingTemplate as any).media_url && (
                    <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                      <img src={(editingTemplate as any).media_url} alt="Exercise reference" style={{ width: "100%", maxHeight: 160, objectFit: "cover", display: "block" }} />
                      <button onClick={() => setEditingTemplate(t => t ? { ...t, media_url: null } as any : t)} style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                    </div>
                  )}
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 6, border: `1px dashed ${C.border}`, cursor: "pointer", color: C.textMuted, fontSize: 12 }}>
                    <span>{(editingTemplate as any).media_url ? "Replace image / GIF" : "Upload image / GIF"}</span>
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: "none" }} onChange={e => { const file = e.target.files?.[0]; if (file && editingTemplate) handleMediaUpload(editingTemplate, file); }} />
                  </label>
                  <div style={{ fontSize: 11, color: C.textDim }}>JPG, PNG, GIF or WebP — max 5MB.</div>
                </div>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Field label="Default Reps"><Input type="number" value={editingTemplate.default_reps} onChange={v => setEditingTemplate(t => t ? { ...t, default_reps: parseInt(v) || 1 } : t)} min={1} max={30} /></Field>
                <Field label="Hold (s)"><Input type="number" value={msToSeconds(editingTemplate.default_hold_ms)} onChange={v => setEditingTemplate(t => t ? { ...t, default_hold_ms: secondsToMs(v) } : t)} min={0} max={10} step={0.5} /></Field>
                <Field label="Rest (s)"><Input type="number" value={msToSeconds(editingTemplate.default_rest_ms)} onChange={v => setEditingTemplate(t => t ? { ...t, default_rest_ms: secondsToMs(v) } : t)} min={0} max={30} step={0.5} /></Field>
              </div>
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>Clinical Setup</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Patient Position" hint="Required starting position">
                    <select value={(editingTemplate as any).patient_position ?? "standing"} onChange={e => setEditingTemplate(t => t ? { ...t, patient_position: e.target.value } as any : t)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%" }}>
                      <option value="standing">Standing</option><option value="seated">Seated</option><option value="either">Either</option>
                    </select>
                  </Field>
                  <Field label="Camera Position" hint="Best angle for measurement">
                    <select value={(editingTemplate as any).camera_position ?? "front"} onChange={e => setEditingTemplate(t => t ? { ...t, camera_position: e.target.value } as any : t)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%" }}>
                      <option value="front">Front-facing</option><option value="side">Side-on</option><option value="either">Either</option>
                    </select>
                  </Field>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Range of Motion</div>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>Degrees — start → target → minimum acceptable for rep to count</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                  <Field label="Start"><Input type="number" value={(editingTemplate as any).rom_start_degrees ?? 0} onChange={v => setEditingTemplate(t => t ? { ...t, rom_start_degrees: parseInt(v) || 0 } as any : t)} min={0} max={180} /></Field>
                  <Field label="Target"><Input type="number" value={(editingTemplate as any).rom_norm_degrees ?? ""} onChange={v => setEditingTemplate(t => t ? { ...t, rom_norm_degrees: parseInt(v) || 0 } as any : t)} min={0} max={180} /></Field>
                  <Field label="Min"><Input type="number" value={(editingTemplate as any).rom_acceptable_min ?? ""} onChange={v => setEditingTemplate(t => t ? { ...t, rom_acceptable_min: parseInt(v) || 0 } as any : t)} min={0} max={180} /></Field>
                  <Field label="Max"><Input type="number" value={(editingTemplate as any).rom_max_degrees ?? ""} onChange={v => setEditingTemplate(t => t ? { ...t, rom_max_degrees: parseInt(v) || 0 } as any : t)} min={0} max={180} /></Field>
                </div>
              </div>
            </div>
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, background: C.surface, display: "flex", gap: 10, flexShrink: 0 }}>
              <Btn onClick={() => setEditingTemplate(null)} variant="ghost">Cancel</Btn>
              <Btn onClick={() => handleSave(editingTemplate)} variant="primary" disabled={saving} fullWidth>{saving ? "Saving…" : editingTemplate.id ? "Update Exercise" : "Save to My Library"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "library" | "patients" | "sessions";

export default function AdminPage() {
  const supabase = getSupabaseClient();
  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [allPrescriptions, setAllPrescriptions] = useState<PrescribedSession[]>([]);
  const [allTemplates, setAllTemplates] = useState<SessionTemplate[]>([]);
  const [physioName, setPhysioName] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = "/login"; return; }
      setPhysioName(session.user.user_metadata?.full_name ?? session.user.email ?? null);
    });
  }, [supabase]);

  const handleLogout = async () => { await supabase.auth.signOut(); window.location.href = "/login"; };
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadShared = useCallback(async () => {
    const [{ data: sess }, { data: tmpl }] = await Promise.all([
      supabase.from("sessions").select(`*, session_blocks(sequence_order, session_block_exercises(sequence_order, reps_override, hold_ms_override, exercise_templates(display_name, default_reps, default_hold_ms))), prescription_exercises(sequence_order, reps_override, hold_ms_override, exercise_templates(display_name, default_reps, default_hold_ms))`).order("created_at", { ascending: false }),
      supabase.from("protocols").select("*, protocol_exercises(*, exercise_templates(id, display_name, default_reps, default_hold_ms, rom_start_degrees, rom_norm_degrees, rom_max_degrees, rom_acceptable_min))").order("title"),
    ]);
    if (sess) setAllPrescriptions(sess.map((s: Record<string, unknown>) => {
      const blocks = (s.session_blocks as Record<string, unknown>[]) ?? [];
      const blockExercises = blocks.flatMap((b: Record<string, unknown>) => ((b.session_block_exercises as Record<string, unknown>[]) ?? [])).sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number));
      const pe = blockExercises.length > 0 ? blockExercises : ((s.prescription_exercises as Record<string, unknown>[]) ?? []).sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number));
      return { id: s.id as string, title: s.title as string, objective: s.objective as string | null, patient_id: s.patient_id as string | null, status: s.status as string, estimated_duration_mins: s.estimated_duration_mins as number, created_at: s.created_at as string, source_protocol_id: s.source_protocol_id as string | null, exercises: pe.map(e => ({ display_name: (e.exercise_templates as { display_name: string } | null)?.display_name ?? "Unknown", reps: (e.reps_override as number) ?? 6, hold_ms: (e.hold_ms_override as number) ?? 2000, sequence_order: e.sequence_order as number })) };
    }));
    if (tmpl) setAllTemplates(tmpl.map((t: Record<string, unknown>) => ({
      id: t.id as string, title: t.title as string, objective: t.objective as string | null, estimated_duration_mins: t.estimated_duration_mins as number, tags: (t.tags as string[]) ?? [], created_at: t.created_at as string,
      exercises: ((t.protocol_exercises as Record<string, unknown>[]) ?? []).sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number)).map(e => ({ id: e.id as string, template_id: e.template_id as string, exercise_template_id: e.exercise_template_id as string, sequence_order: e.sequence_order as number, default_reps: e.default_reps as number | null, default_hold_ms: e.default_hold_ms as number | null, exercise_template: e.exercise_templates as SessionTemplateExercise["exercise_template"] })),
    })));
  }, [supabase]);

  useEffect(() => { loadShared(); }, [loadShared]);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "library",  label: "Exercise Library", icon: "🏋️" },
    { key: "patients", label: "Patients",          icon: "👤" },
    { key: "sessions", label: "Protocols",         icon: "📋" },
  ];

  const initials = physioName
    ? physioName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* ── Nav bar ── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 16px", display: "flex", alignItems: "center", height: 56, position: "sticky", top: 0, background: C.bg, zIndex: 50, gap: 8 }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Rehably</span>
        </div>

        {/* Desktop tabs — hidden on mobile via media query workaround: use flex with overflow hidden */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", gap: 2 }}>
          {tabs.map(({ key, label, icon }) => (
            <button key={key} onClick={() => { setActiveTab(key); loadShared(); setMobileMenuOpen(false); }}
              style={{ background: activeTab === key ? C.surfaceHover : "transparent", border: "none", borderBottom: activeTab === key ? `2px solid ${C.blue}` : "2px solid transparent", padding: "0 14px", height: 56, color: activeTab === key ? C.text : C.textMuted, fontSize: 13, fontWeight: activeTab === key ? 600 : 400, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" as const, flexShrink: 0, transition: "all 0.15s" }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </div>

        {/* Right side: avatar + sign out */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
          {physioName && (
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }} title={physioName}>
              {initials}
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 12px", color: C.textMuted, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = C.red; (e.target as HTMLButtonElement).style.color = C.red; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = C.border; (e.target as HTMLButtonElement).style.color = C.textMuted; }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* ── Mobile tab bar (below nav, always visible on small screens) ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, overflowX: "auto" as const, WebkitOverflowScrolling: "touch" as any }}>
        {tabs.map(({ key, label, icon }) => (
          <button key={key} onClick={() => { setActiveTab(key); loadShared(); }}
            style={{ flex: "0 0 auto", background: "none", border: "none", borderBottom: activeTab === key ? `2px solid ${C.blue}` : "2px solid transparent", padding: "10px 20px", color: activeTab === key ? C.blue : C.textMuted, fontSize: 13, fontWeight: activeTab === key ? 600 : 400, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" as const }}>
            <span>{icon}</span> {label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
        {activeTab === "library"  && <ExerciseLibraryTab showToast={showToast} />}
        {activeTab === "patients" && <PatientsTab showToast={showToast} prescriptions={allPrescriptions} templates={allTemplates} onRefresh={loadShared} />}
        {activeTab === "sessions" && <SessionTemplatesTab showToast={showToast} />}
      </div>

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  );
}
