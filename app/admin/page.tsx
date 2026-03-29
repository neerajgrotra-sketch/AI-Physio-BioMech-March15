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
  exercise_template?: { id: string; display_name: string; default_reps: number; default_hold_ms: number; exercise_type: string; };
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

interface ExerciseResult {
  id: string; sequence_order: number;
  reps_prescribed: number; reps_attempted: number; reps_successful: number; reps_failed: number;
  hold_compliance_rate: number | null;
  failed_hold_count: number; failed_height_count: number;
  failed_balance_count: number; failed_isolation_count: number;
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

  useEffect(() => {
    async function load() {
      const [{ data: res }, { data: blocks }, { data: peOld }] = await Promise.all([
        supabase.from("session_results").select("*, exercise_results(*)").eq("prescription_id", prescriptionId).order("created_at", { ascending: false }).limit(1).single(),
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
      <div style={{ width: "min(640px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{sessionTitle}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Session Results</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>Loading results…</div> : !result ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textDim }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div>No results found for this session.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Mobility Score */}
              <div style={{ background: C.bg, border: `1px solid ${scoreColor}40`, borderRadius: 12, padding: "24px", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>Mobility Score</div>
                <div style={{ fontSize: 72, fontWeight: 800, color: scoreColor, lineHeight: 1, marginBottom: 8 }}>{score ?? "—"}</div>
                <div style={{ fontSize: 13, color: C.textMuted }}>out of 100</div>
                {result.duration_ms && <div style={{ fontSize: 12, color: C.textDim, marginTop: 12 }}>Session duration: {formatDuration(result.duration_ms)}</div>}
                {result.completed_at && <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>Completed: {formatDate(result.completed_at)}</div>}
              </div>

              {/* Exercise Breakdown */}
              <div>
                <SectionHeader title="Exercise Breakdown" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.exercise_results.sort((a, b) => a.sequence_order - b.sequence_order).map((ex, i) => {
                    const exName = prescriptionExercises.find(p => p.sequence_order === ex.sequence_order)?.display_name ?? `Exercise ${i + 1}`;
                    const completionPct = ex.reps_prescribed > 0 ? Math.round(ex.reps_successful / ex.reps_prescribed * 100) : 0;
                    const holdPct = ex.hold_compliance_rate !== null ? Math.round(ex.hold_compliance_rate * 100) : null;
                    const exColor = completionPct >= 80 ? C.green : completionPct >= 60 ? C.orange : C.red;
                    return (
                      <div key={ex.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 24, height: 24, borderRadius: "50%", background: exColor + "20", color: exColor, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{exName}</span>
                          </div>
                          <span style={{ fontSize: 18, fontWeight: 700, color: exColor }}>{completionPct}%</span>
                        </div>
                        {/* Progress bar */}
                        <div style={{ height: 4, background: C.border, borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${completionPct}%`, background: exColor, borderRadius: 2, transition: "width 0.6s ease" }} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
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
                        {/* Failure breakdown */}
                        {(ex.failed_height_count > 0 || ex.failed_hold_count > 0 || ex.failed_balance_count > 0 || ex.failed_isolation_count > 0) && (
                          <div style={{ marginTop: 10, padding: "8px 12px", background: C.redDim, border: `1px solid ${C.red}20`, borderRadius: 6, fontSize: 12 }}>
                            <span style={{ color: C.textMuted, marginRight: 8 }}>Failures:</span>
                            {ex.failed_height_count > 0 && <span style={{ color: C.red, marginRight: 8 }}>Height ×{ex.failed_height_count}</span>}
                            {ex.failed_hold_count > 0 && <span style={{ color: C.orange, marginRight: 8 }}>Hold ×{ex.failed_hold_count}</span>}
                            {ex.failed_balance_count > 0 && <span style={{ color: C.purple, marginRight: 8 }}>Balance ×{ex.failed_balance_count}</span>}
                            {ex.failed_isolation_count > 0 && <span style={{ color: C.blue }}>Isolation ×{ex.failed_isolation_count}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Clinical Summary */}
              {result.claude_summary && (
                <div>
                  <SectionHeader title="Clinical Summary" />
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", fontSize: 13, color: C.text, lineHeight: 1.7 }}>{result.claude_summary}</div>
                </div>
              )}

              {/* Export */}
              <Btn onClick={() => {
                const lines = [
                  `Session: ${sessionTitle}`,
                  `Date: ${result.completed_at ? formatDate(result.completed_at) : "—"}`,
                  `Mobility Score: ${score ?? "—"}/100`,
                  `Duration: ${result.duration_ms ? formatDuration(result.duration_ms) : "—"}`,
                  "",
                  "Exercise Results:",
                  ...result.exercise_results.sort((a, b) => a.sequence_order - b.sequence_order).map((ex, i) => {
                    const name = prescriptionExercises.find(p => p.sequence_order === ex.sequence_order)?.display_name ?? `Exercise ${i + 1}`;
                    return `  ${i + 1}. ${name}: ${ex.reps_successful}/${ex.reps_prescribed} reps (${ex.reps_failed} failed)`;
                  }),
                  result.claude_summary ? `\nClinical Note:\n${result.claude_summary}` : "",
                ].join("\n");
                navigator.clipboard.writeText(lines);
              }} variant="ghost">📋 Copy to Clipboard</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Assign Protocol Flow (inside Patient Profile) ────────────────────────────

function AssignSessionPanel({ patient, templates, onAssign, onCancel }: { patient: Patient; templates: SessionTemplate[]; onAssign: () => void; onCancel: () => void; }) {
  const supabase = getSupabaseClient();
  const [step, setStep] = useState<"pick" | "override">("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<SessionTemplate | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<{ reps: number; hold_ms: number; note: string; }[]>([]);
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
    })));
    setStep("override");
  };

  const assign = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      // 1. Create the session row
      const { data: session, error: sErr } = await supabase
        .from("sessions")
        .insert({
          title: selectedTemplate.title,
          objective: selectedTemplate.objective,
          patient_id: patient.id,
          physio_id: null,
          estimated_duration_mins: selectedTemplate.estimated_duration_mins,
          status: "pending",
          source_protocol_id: selectedTemplate.id,
        })
        .select().single();
      if (sErr) throw sErr;

      // 2. Create session_block (one block for single-protocol assignment)
      const { data: block, error: bErr } = await supabase
        .from("session_blocks")
        .insert({
          session_id: session.id,
          protocol_id: selectedTemplate.id,
          sequence_order: 0,
          rest_before_ms: 0,
        })
        .select().single();
      if (bErr) throw bErr;

      // 3. Create session_block_exercises with per-patient overrides
      const { error: eErr } = await supabase.from("session_block_exercises").insert(
        selectedTemplate.exercises.map((ex, i) => ({
          session_block_id: block.id,
          exercise_template_id: ex.exercise_template_id,
          sequence_order: i,
          reps_override: overrides[i]?.reps ?? null,
          hold_ms_override: overrides[i]?.hold_ms ?? null,
          coaching_notes: overrides[i]?.note || null,
        }))
      );
      if (eErr) throw eErr;
      onAssign();
    } catch (err) {
      console.error("Assign failed:", err);
    } finally { setSaving(false); }
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
        <div style={{ textAlign: "center", padding: "32px 0", color: C.textDim, fontSize: 13 }}>No templates match your filter. Create templates in the Sessions tab.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
          {filteredTemplates.map(t => (
            <div key={t.id} onClick={() => selectTemplate(t)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus)} onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
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
      <div style={{ fontSize: 12, color: C.textMuted }}>Adjust reps and hold duration per exercise if needed for {patient.full_name}.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
        {selectedTemplate?.exercises.sort((a, b) => a.sequence_order - b.sequence_order).map((ex, i) => (
          <div key={ex.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>{i + 1}. {ex.exercise_template?.display_name}</div>
            <div style={{ display: "flex", gap: 12 }}>
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
          </div>
        ))}
      </div>
      <Btn onClick={assign} variant="primary" disabled={saving} fullWidth>{saving ? "Assigning…" : `Assign Protocol to ${patient.full_name}`}</Btn>
    </div>
  );
}

// ─── Patient Profile Panel ────────────────────────────────────────────────────

function PatientProfilePanel({ patient, prescriptions, templates, onClose, onEdit, onDelete, onRefresh }: { patient: Patient; prescriptions: PrescribedSession[]; templates: SessionTemplate[]; onClose: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void; }) {
  const age = patient.date_of_birth ? calcAge(patient.date_of_birth) : null;
  const bmi = patient.height_cm && patient.weight_kg ? calcBMI(patient.height_cm, patient.weight_kg) : null;
  const bmiInfo = bmi ? bmiCategory(bmi) : null;
  const patientSessions = prescriptions.filter(s => s.patient_id === patient.id);
  const completedSessions = patientSessions.filter(s => s.status === "completed");
  const [assigning, setAssigning] = useState(false);
  const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
  const [viewingResultsTitle, setViewingResultsTitle] = useState<string>("");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", justifyContent: "flex-end" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(520px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16 }}>
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {assigning ? (
            <AssignSessionPanel patient={patient} templates={templates} onAssign={() => { setAssigning(false); onRefresh(); }} onCancel={() => setAssigning(false)} />
          ) : (
            <>
              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
                {[
                  { label: "Sessions", value: patientSessions.length },
                  { label: "Completed", value: completedSessions.length },
                  { label: "Pending", value: patientSessions.filter(s => s.status === "pending").length },
                  { label: "Completion", value: patientSessions.length > 0 ? `${Math.round(completedSessions.length / patientSessions.length * 100)}%` : "—" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{value}</div>
                    <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Physical */}
              {(patient.height_cm || patient.weight_kg || patient.date_of_birth) && (
                <div style={{ marginBottom: 20 }}>
                  <SectionHeader title="Physical" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {patient.date_of_birth && <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Date of Birth</div><div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>{formatDate(patient.date_of_birth)}</div>{age !== null && <div style={{ fontSize: 12, color: C.textMuted }}>Age {age}</div>}</div>}
                    {patient.height_cm && <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Height</div><div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>{patient.height_cm} cm</div><div style={{ fontSize: 12, color: C.textMuted }}>{cmToFtIn(patient.height_cm).ft}′ {cmToFtIn(patient.height_cm).inches}″</div></div>}
                    {patient.weight_kg && <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Weight</div><div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>{patient.weight_kg} kg</div><div style={{ fontSize: 12, color: C.textMuted }}>{kgToLbs(patient.weight_kg)} lbs</div></div>}
                    {bmi && bmiInfo && <div style={{ background: bmiInfo.color + "15", border: `1px solid ${bmiInfo.color}30`, borderRadius: 8, padding: "10px 14px" }}><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>BMI</div><div style={{ fontSize: 14, fontWeight: 700, color: bmiInfo.color, marginTop: 2 }}>{bmi} · {bmiInfo.label}</div></div>}
                  </div>
                </div>
              )}

              {/* Clinical */}
              {(patient.condition_notes || patient.goals) && (
                <div style={{ marginBottom: 20 }}>
                  <SectionHeader title="Clinical" />
                  {patient.condition_notes && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 4 }}>Condition</div><div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{patient.condition_notes}</div></div>}
                  {patient.goals && <div><div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 4 }}>Goals</div><div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{patient.goals}</div></div>}
                </div>
              )}

              {/* Sessions */}
              <div>
                <SectionHeader title={`Sessions (${patientSessions.length})`} action={<Btn onClick={() => setAssigning(true)} variant="primary" small>+ Assign Protocol</Btn>} />
                {patientSessions.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.textDim, padding: "16px 0", textAlign: "center" }}>No sessions assigned yet. Click "+ Assign Protocol" to add one.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {patientSessions.map(s => (
                      <div key={s.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.title}</div>
                            <div style={{ fontSize: 11, color: C.textDim }}>{s.exercises.length} exercise{s.exercises.length !== 1 ? "s" : ""} · {s.estimated_duration_mins} min · {formatDate(s.created_at)}</div>
                          </div>
                          <Badge label={s.status} color={s.status === "completed" ? C.green : s.status === "pending" ? C.blue : C.textMuted} />
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Btn onClick={() => window.open(`/session?prescription=${s.id}`, "_blank")} small>{s.status === "completed" ? "↺ Re-run" : "▶ Run"}</Btn>
                          {s.status === "completed" && <Btn onClick={() => { setViewingResultsId(s.id); setViewingResultsTitle(s.title); }} small variant="ghost">📊 Results</Btn>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!assigning && (
          <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
            <Btn onClick={onEdit} variant="primary">Edit Profile</Btn>
            <Btn onClick={onDelete} variant="danger">Delete Patient</Btn>
          </div>
        )}
      </div>

      {/* Results drill-down */}
      {viewingResultsId && (
        <SessionResultsPanel prescriptionId={viewingResultsId} sessionTitle={viewingResultsTitle} onClose={() => setViewingResultsId(null)} />
      )}
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
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
  const [exercises, setExercises] = useState<{ template_id: string; display_name: string; reps: number; hold_ms: number; }[]>([]);
  const [selectedExTemplateId, setSelectedExTemplateId] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: et }, { data: st }] = await Promise.all([
      supabase.from("exercise_templates").select("*").order("display_name"),
      supabase.from("protocols").select("*, protocol_exercises(*, exercise_templates(id, display_name, default_reps, default_hold_ms))").order("created_at", { ascending: false }),
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
    setExercises(prev => [...prev, { template_id: et.id, display_name: et.display_name, reps: et.default_reps, hold_ms: et.default_hold_ms }]);
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

  const saveTemplate = async () => {
    if (!title.trim()) { showToast("Title is required.", false); return; }
    if (exercises.length === 0) { showToast("Add at least one exercise.", false); return; }
    setSaving(true);
    try {
      const { data: tmpl, error: tErr } = await supabase.from("protocols").insert({ title: title.trim(), objective: objective || null, estimated_duration_mins: parseInt(estimatedMins) || 10, tags }).select().single();
      if (tErr) throw tErr;
      const { error: eErr } = await supabase.from("protocol_exercises").insert(
        exercises.map((e, i) => ({ protocol_id: tmpl.id, exercise_template_id: e.template_id, sequence_order: i, default_reps: e.reps, default_hold_ms: e.hold_ms }))
      );
      if (eErr) throw eErr;
      showToast("Protocol saved.");
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
  const filteredTemplates = savedTemplates.filter(t => {
    const ms = search === "" || t.title.toLowerCase().includes(search.toLowerCase());
    const mt = tagFilter === "" || t.tags.includes(tagFilter);
    return ms && mt;
  });

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24, alignItems: "start" }}>
      {/* Builder form */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Protocol Builder</h2>
        <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 20px" }}>Build reusable clinical protocols. Assign them to patients from the patient profile.</p>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionHeader title="Protocol Details" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 14 }}>
            <Field label="Protocol Title"><Input value={title} onChange={setTitle} placeholder="Shoulder Mobility A" /></Field>
            <Field label="Duration (mins)"><Input type="number" value={estimatedMins} onChange={setEstimatedMins} min={1} max={120} /></Field>
          </div>
          <Field label="Objective"><Input value={objective} onChange={setObjective} placeholder="e.g. Build shoulder strength and range of motion" /></Field>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const, display: "block", marginBottom: 8 }}>Tags</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
              {tags.map(tag => (
                <span key={tag} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, background: C.blueDim, border: `1px solid ${C.blue}30`, fontSize: 12, color: C.blue }}>
                  {tag}
                  <button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); } }} placeholder="Add tag (Enter to add)…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              <Btn onClick={() => addTag(tagInput)} small variant="ghost">Add</Btn>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 8 }}>
              {SUGGESTED_TAGS.filter(t => !tags.includes(t)).slice(0, 10).map(t => (
                <button key={t} onClick={() => addTag(t)} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 12, padding: "2px 8px", fontSize: 11, color: C.textMuted, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
              ))}
            </div>
          </div>

          {/* Exercises */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <SectionHeader title="Exercises" />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <Select value={selectedExTemplateId} onChange={setSelectedExTemplateId}>
                  {exerciseTemplates.map(t => <option key={t.id} value={t.id}>{t.display_name} · {t.default_reps} reps · {msToSeconds(t.default_hold_ms)}s hold</option>)}
                </Select>
              </div>
              <Btn onClick={addExercise} variant="primary">+ Add</Btn>
            </div>
            {exercises.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: C.textDim, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>No exercises added yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {exercises.map((ex, idx) => (
                  <div key={idx} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button onClick={() => moveExercise(idx, -1)} disabled={idx === 0} style={{ background: "none", border: "none", color: idx === 0 ? C.textDim : C.textMuted, cursor: idx === 0 ? "default" : "pointer", fontSize: 12, padding: 2 }}>▲</button>
                      <span style={{ fontSize: 11, color: C.textDim, textAlign: "center" as const }}>{idx + 1}</span>
                      <button onClick={() => moveExercise(idx, 1)} disabled={idx === exercises.length - 1} style={{ background: "none", border: "none", color: idx === exercises.length - 1 ? C.textDim : C.textMuted, cursor: idx === exercises.length - 1 ? "default" : "pointer", fontSize: 12, padding: 2 }}>▼</button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>{ex.display_name}</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        {[["Reps", "reps", ex.reps, 1, 30, 1], ["Hold (s)", "hold_ms", msToSeconds(ex.hold_ms), 0, 10, 0.5]].map(([label, key, val, min, max, step]) => (
                          <div key={String(key)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: C.textDim }}>{label}</span>
                            <input type="number" value={val} min={Number(min)} max={Number(max)} step={Number(step)}
                              onChange={e => setExercises(prev => prev.map((ex2, i) => i === idx ? { ...ex2, [key as string]: key === "hold_ms" ? secondsToMs(e.target.value) : parseInt(e.target.value) || 1 } : ex2))}
                              style={{ width: 52, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
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

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: "flex", gap: 10 }}>
            <Btn onClick={() => { setTitle("New Protocol"); setObjective(""); setEstimatedMins("10"); setTags([]); setExercises([]); }} variant="danger" small>Clear</Btn>
            <Btn onClick={saveTemplate} variant="primary" disabled={saving} fullWidth>{saving ? "Saving…" : "💾 Save Protocol"}</Btn>
          </div>
        </div>
      </div>

      {/* Template library */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Protocol Library</h2>
        <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 14px" }}>{savedTemplates.length} protocol{savedTemplates.length !== 1 ? "s" : ""}</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
            <option value="">All tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {filteredTemplates.length === 0 ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "32px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, color: C.textMuted }}>No protocols yet. Build your first one.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredTemplates.map(t => (
              <div key={t.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{t.title}</div>
                  <span style={{ fontSize: 11, color: C.textDim, whiteSpace: "nowrap" as const }}>{t.exercises.length} ex · {t.estimated_duration_mins}min</span>
                </div>
                {t.objective && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>{t.objective}</div>}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginBottom: 10 }}>
                  {t.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: C.blueDim, color: C.blue, fontWeight: 600 }}>{tag}</span>)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                  {t.exercises.map((ex, i) => (
                    <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
                      <span style={{ color: C.textDim, minWidth: 16 }}>{i + 1}.</span>
                      <span style={{ flex: 1, color: C.text }}>{ex.exercise_template?.display_name}</span>
                      <span>{ex.default_reps ?? ex.exercise_template?.default_reps}× · {msToSeconds(ex.default_hold_ms ?? ex.exercise_template?.default_hold_ms ?? 0)}s</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  <Btn onClick={() => deleteTemplate(t.id)} variant="danger" small>Delete</Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Exercise Library Tab (unchanged) ────────────────────────────────────────

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

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    const [{ data: v }, { data: m }] = await Promise.all([
      supabase.from("exercise_templates").select("*").eq("is_vanilla", true).order("display_name"),
      supabase.from("exercise_templates").select("*").eq("is_vanilla", false).order("display_name"),
    ]);
    setVanillaTemplates(v ?? []); setMyTemplates(m ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleSave = async (template: ExerciseTemplate) => {
    setSaving(true);
    try {
      const isNew = !template.id || template.is_vanilla;
      const payload = { ...template, is_vanilla: false, created_by: null };
      if (isNew) {
        const { id: _id, ...insertPayload } = payload;
        const { error } = await supabase.from("exercise_templates").insert(insertPayload);
        if (error) throw error; showToast("Exercise created in My Library.");
      } else {
        const { error } = await supabase.from("exercise_templates").update(payload).eq("id", template.id);
        if (error) throw error; showToast("Exercise updated.");
      }
      setEditingTemplate(null); loadTemplates();
    } catch (err: unknown) { showToast(err instanceof Error ? err.message : "Save failed.", false); }
    finally { setSaving(false); }
  };

  const raw = subTab === "vanilla" ? vanillaTemplates : myTemplates;
  const active = raw.filter(t => {
    const ms = search === "" || t.display_name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? "").toLowerCase().includes(search.toLowerCase());
    const mt = typeFilter === "all" || t.exercise_type === typeFilter;
    return ms && mt;
  });

  // Keep the existing ExerciseLibraryTab render — it's not changing in module 7
  // Placeholder render to keep the file compiling:
  return (
    <div>
      <div style={{ display: "flex", gap: 2, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 16 }}>
        {[{ key: "vanilla", label: `System (${vanillaTemplates.length})` }, { key: "mine", label: `My Library (${myTemplates.length})` }].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key as "vanilla" | "mine")} style={{ background: subTab === key ? C.surfaceHover : "transparent", border: `1px solid ${subTab === key ? C.border : "transparent"}`, borderRadius: 6, padding: "6px 16px", color: subTab === key ? C.text : C.textMuted, fontSize: 13, fontWeight: subTab === key ? 600 : 400, fontFamily: "inherit", cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search exercises…" style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
          <option value="all">All types</option><option value="arm_raise">Arm Raise</option><option value="bilateral_arm_raise">Bilateral Arm Raise</option><option value="sit_to_stand">Sit to Stand</option><option value="custom">Custom</option>
        </select>
      </div>
      {loading ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted }}>Loading…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {active.map(t => (
            <div key={t.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{t.display_name}</div>
                {t.is_vanilla && <Badge label="System" color={C.textMuted} />}
              </div>
              {t.description && <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>{t.description}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontSize: 11, color: C.textDim }}>Default: {t.default_reps} reps · {msToSeconds(t.default_hold_ms)}s hold</span>
              </div>
              <Btn onClick={() => setEditingTemplate({ ...t })} small variant="ghost">{t.is_vanilla ? "Customise →" : "Edit"}</Btn>
            </div>
          ))}
          {active.length === 0 && <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 0", color: C.textDim }}>No exercises match your filter.</div>}
        </div>
      )}
      {editingTemplate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", justifyContent: "flex-end" }} onClick={e => { if (e.target === e.currentTarget) setEditingTemplate(null); }}>
          <div style={{ width: "min(500px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{editingTemplate.is_vanilla ? `Customise: ${editingTemplate.display_name}` : `Edit: ${editingTemplate.display_name}`}</h3>
              <button onClick={() => setEditingTemplate(null)} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <Field label="Display Name"><Input value={editingTemplate.display_name} onChange={v => setEditingTemplate(t => t ? { ...t, display_name: v } : t)} /></Field>
            <Field label="Description"><Textarea value={editingTemplate.description ?? ""} onChange={v => setEditingTemplate(t => t ? { ...t, description: v } : t)} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Default Reps"><Input type="number" value={editingTemplate.default_reps} onChange={v => setEditingTemplate(t => t ? { ...t, default_reps: parseInt(v) || 1 } : t)} min={1} max={30} /></Field>
              <Field label="Hold (s)"><Input type="number" value={msToSeconds(editingTemplate.default_hold_ms)} onChange={v => setEditingTemplate(t => t ? { ...t, default_hold_ms: secondsToMs(v) } : t)} min={0} max={10} step={0.5} /></Field>
              <Field label="Rest (s)"><Input type="number" value={msToSeconds(editingTemplate.default_rest_ms)} onChange={v => setEditingTemplate(t => t ? { ...t, default_rest_ms: secondsToMs(v) } : t)} min={0} max={30} step={0.5} /></Field>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <Btn onClick={() => setEditingTemplate(null)} variant="ghost">Cancel</Btn>
              <Btn onClick={() => handleSave(editingTemplate)} variant="primary" disabled={saving} fullWidth>{saving ? "Saving…" : editingTemplate.is_vanilla ? "Save to My Library" : "Update"}</Btn>
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

  // ─── Auth guard ───────────────────────────────────────────────────────────
  const [authChecked, setAuthChecked] = useState(false);
  const [physioName, setPhysioName] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = "/login";
      } else {
        setPhysioName(session.user.user_metadata?.full_name ?? session.user.email ?? "Physio");
        setAuthChecked(true);
      }
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  if (!authChecked) return null;

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadShared = useCallback(async () => {
    const [{ data: sess }, { data: tmpl }] = await Promise.all([
      supabase.from("sessions").select("*, prescription_exercises(sequence_order, reps_override, hold_ms_override, exercise_templates(display_name, default_reps, default_hold_ms))").order("created_at", { ascending: false }),
      supabase.from("protocols").select("*, protocol_exercises(*, exercise_templates(id, display_name, default_reps, default_hold_ms))").order("title"),
    ]);
    if (sess) setAllPrescriptions(sess.map((s: Record<string, unknown>) => {
      const pe = (s.prescription_exercises as Record<string, unknown>[]) ?? [];
      return { id: s.id as string, title: s.title as string, objective: s.objective as string | null, patient_id: s.patient_id as string | null, status: s.status as string, estimated_duration_mins: s.estimated_duration_mins as number, created_at: s.created_at as string, source_protocol_id: s.source_protocol_id as string | null, exercises: pe.sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number)).map(e => ({ display_name: (e.exercise_templates as { display_name: string } | null)?.display_name ?? "Unknown", reps: (e.reps_override as number) ?? 6, hold_ms: (e.hold_ms_override as number) ?? 2000, sequence_order: e.sequence_order as number })) };
    }));
    if (tmpl) setAllTemplates(tmpl.map((t: Record<string, unknown>) => ({
      id: t.id as string, title: t.title as string, objective: t.objective as string | null, estimated_duration_mins: t.estimated_duration_mins as number, tags: (t.tags as string[]) ?? [], created_at: t.created_at as string,
      exercises: ((t.protocol_exercises as Record<string, unknown>[]) ?? []).sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number)).map(e => ({ id: e.id as string, template_id: e.template_id as string, exercise_template_id: e.exercise_template_id as string, sequence_order: e.sequence_order as number, default_reps: e.default_reps as number | null, default_hold_ms: e.default_hold_ms as number | null, exercise_template: e.exercise_templates as SessionTemplateExercise["exercise_template"] })),
    })));
  }, [supabase]);

  useEffect(() => { loadShared(); }, [loadShared]);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "library", label: "Exercise Library", icon: "🏋️" },
    { key: "patients", label: "Patients", icon: "👤" },
    { key: "sessions", label: "Protocols", icon: "📋" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 32px", display: "flex", alignItems: "center", height: 56, position: "sticky", top: 0, background: C.bg, zIndex: 50 }}>

        {/* Left: logo + tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 32 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>AI Physio</span>
          <span style={{ color: C.border, fontSize: 16, margin: "0 4px" }}>|</span>
          <span style={{ fontSize: 14, color: C.textMuted }}>Admin</span>
        </div>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {tabs.map(({ key, label, icon }) => (
            <button key={key} onClick={() => { setActiveTab(key); loadShared(); }} style={{ background: activeTab === key ? C.surfaceHover : "transparent", border: "none", borderBottom: activeTab === key ? `2px solid ${C.blue}` : "2px solid transparent", padding: "0 16px", height: 56, color: activeTab === key ? C.text : C.textMuted, fontSize: 13, fontWeight: activeTab === key ? 600 : 400, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s" }}>
              <span>{icon}</span> {label}
            </button>
          ))}
        </div>

        {/* Right: physio badge + logout */}
        {physioName && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 12px 5px 8px" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {physioName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <span style={{ fontSize: 12, color: C.text, fontWeight: 500, whiteSpace: "nowrap" }}>{physioName}</span>
            </div>
            <button onClick={handleLogout} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", color: C.textMuted, fontSize: 12, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = C.red; (e.target as HTMLButtonElement).style.color = C.red; }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = C.border; (e.target as HTMLButtonElement).style.color = C.textMuted; }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px" }}>
        {activeTab === "library" && <ExerciseLibraryTab showToast={showToast} />}
        {activeTab === "patients" && <PatientsTab showToast={showToast} prescriptions={allPrescriptions} templates={allTemplates} onRefresh={loadShared} />}
        {activeTab === "sessions" && <SessionTemplatesTab showToast={showToast} />}
      </div>

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  );
}
