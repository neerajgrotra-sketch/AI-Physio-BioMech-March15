"use client";

// app/admin/page.tsx
// Physio admin — Exercise Library + Patients + Sessions
// Enhanced patient profile: photo, height/weight/BMI, age calc, slide-out panel

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ExerciseTemplate, CoachingStrings } from "@/lib/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  patient_type: string;
  condition_notes: string | null;
  goals: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  photo_url: string | null;
  created_at: string;
}

interface PatientForm {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  patient_type: string;
  condition_notes: string;
  goals: string;
  height_cm: string;
  weight_kg: string;
  // UI-only unit state
  height_unit: "cm" | "ft";
  weight_unit: "kg" | "lbs";
  height_ft: string;
  height_in: string;
  weight_lbs: string;
}

interface SessionExercise {
  template_id: string;
  display_name: string;
  reps: number;
  hold_ms: number;
  sequence_order: number;
}

interface SavedSession {
  id: string;
  title: string;
  objective: string | null;
  patient_id: string | null;
  status: string;
  estimated_duration_mins: number;
  created_at: string;
  exercises: SessionExercise[];
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          "#0d1117",
  surface:     "#161b22",
  surfaceHover:"#1c2230",
  border:      "#21262d",
  borderFocus: "#388bfd",
  text:        "#e6edf3",
  textMuted:   "#7d8590",
  textDim:     "#484f58",
  green:       "#3fb950",
  greenDim:    "rgba(63,185,80,0.12)",
  blue:        "#388bfd",
  blueDim:     "rgba(56,139,253,0.12)",
  orange:      "#d29922",
  orangeDim:   "rgba(210,153,34,0.12)",
  red:         "#f85149",
  redDim:      "rgba(248,81,73,0.12)",
  purple:      "#a371f7",
  purpleDim:   "rgba(163,113,247,0.12)",
};

const PATIENT_TYPE_LABELS: Record<string, string> = {
  general_fitness: "General Fitness",
  post_surgery:    "Post Surgery",
  elderly:         "Elderly",
  pediatric:       "Pediatric",
};

const PATIENT_TYPE_COLORS: Record<string, string> = {
  general_fitness: C.blue,
  post_surgery:    C.orange,
  elderly:         C.purple,
  pediatric:       C.green,
};

const EXERCISE_TYPE_COLOR: Record<string, string> = {
  arm_raise:           C.blue,
  bilateral_arm_raise: C.purple,
  sit_to_stand:        C.green,
  custom:              C.orange,
};

// ─── Utility functions ────────────────────────────────────────────────────────

function calcAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function calcBMI(heightCm: number, weightKg: number): number {
  const hm = heightCm / 100;
  return Math.round((weightKg / (hm * hm)) * 10) / 10;
}

function bmiCategory(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: "Underweight", color: C.blue };
  if (bmi < 25)   return { label: "Normal",      color: C.green };
  if (bmi < 30)   return { label: "Overweight",  color: C.orange };
  return              { label: "Obese",         color: C.red };
}

function cmToFtIn(cm: number): { ft: number; inches: number } {
  const totalInches = cm / 2.54;
  return { ft: Math.floor(totalInches / 12), inches: Math.round(totalInches % 12) };
}

function ftInToCm(ft: number, inches: number): number {
  return Math.round((ft * 12 + inches) * 2.54);
}

function kgToLbs(kg: number): number { return Math.round(kg * 2.20462 * 10) / 10; }
function lbsToKg(lbs: number): number { return Math.round(lbs / 2.20462 * 10) / 10; }

function msToSeconds(ms: number) { return (ms / 1000).toFixed(1); }
function secondsToMs(s: string) { return Math.round(parseFloat(s) * 1000); }

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function emptyForm(): PatientForm {
  return {
    first_name: "", last_name: "", date_of_birth: "", patient_type: "general_fitness",
    condition_notes: "", goals: "",
    height_cm: "", weight_kg: "", height_ft: "", height_in: "", weight_lbs: "",
    height_unit: "cm", weight_unit: "kg",
  };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      textTransform: "uppercase" as const, color,
      background: color + "20", border: `1px solid ${color}40`,
    }}>{label}</span>
  );
}

function Field({ label, hint, children, row }: { label: string; hint?: string; children: React.ReactNode; row?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: row ? "row" : "column", gap: row ? 10 : 6, alignItems: row ? "center" : "stretch" }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const, whiteSpace: "nowrap" as const }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: C.textDim, margin: 0 }}>{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder, min, max, step, style: extraStyle }: {
  value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; min?: number; max?: number; step?: number;
  style?: React.CSSProperties;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder} min={min} max={max} step={step}
      onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit",
        outline: "none", width: "100%", boxSizing: "border-box" as const, ...extraStyle,
      }}
      onFocus={e => (e.target.style.borderColor = C.borderFocus)}
      onBlur={e => (e.target.style.borderColor = C.border)}
    />
  );
}

function Textarea({ value, onChange, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <textarea value={value} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: "8px 12px", color: C.text, fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        outline: "none", width: "100%", boxSizing: "border-box" as const,
        resize: "vertical" as const, lineHeight: 1.6,
      }}
      onFocus={e => (e.target.style.borderColor = C.borderFocus)}
      onBlur={e => (e.target.style.borderColor = C.border)}
    />
  );
}

function Select({ value, onChange, children, style: extraStyle }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit",
        outline: "none", width: "100%", cursor: "pointer", ...extraStyle,
      }}
    >{children}</select>
  );
}

function UnitToggle({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          background: value === opt ? C.blue : "transparent",
          color: value === opt ? "#fff" : C.textMuted,
          border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600,
          fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s",
        }}>{opt}</button>
      ))}
    </div>
  );
}

function Btn({ children, onClick, variant = "ghost", disabled, small, fullWidth }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "success"; disabled?: boolean; small?: boolean; fullWidth?: boolean;
}) {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    primary: { bg: C.blue,        color: "#fff",    border: C.blue },
    ghost:   { bg: "transparent", color: C.text,    border: C.border },
    danger:  { bg: "transparent", color: C.red,     border: C.red + "60" },
    success: { bg: C.green,       color: "#fff",    border: C.green },
  };
  const s = styles[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 6, padding: small ? "4px 10px" : "8px 16px",
      fontSize: small ? 12 : 13, fontWeight: 500, fontFamily: "inherit",
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      transition: "all 0.15s", whiteSpace: "nowrap" as const,
      width: fullWidth ? "100%" : "auto",
    }}>{children}</button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 style={{
      fontSize: 11, fontWeight: 700, color: C.textMuted,
      textTransform: "uppercase" as const, letterSpacing: "0.06em",
      margin: "0 0 14px", borderBottom: `1px solid ${C.border}`, paddingBottom: 8,
    }}>{title}</h3>
  );
}

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 300,
      background: ok ? C.greenDim : C.redDim,
      border: `1px solid ${ok ? C.green : C.red}40`,
      color: ok ? C.green : C.red,
      borderRadius: 8, padding: "12px 18px", fontSize: 13, fontWeight: 500,
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    }}>
      {ok ? "✓" : "✕"} {msg}
    </div>
  );
}

// ─── Patient Photo Component ──────────────────────────────────────────────────

function PatientPhoto({ photoUrl, name, size = 64, editable = false, onUpload }: {
  photoUrl: string | null; name: string; size?: number;
  editable?: boolean; onUpload?: (url: string) => void;
}) {
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
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  };

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setStream(s);
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = s;
      }, 100);
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async blob => {
      if (blob) {
        await uploadFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
        stream?.getTracks().forEach(t => t.stop());
        setStream(null);
        setShowCamera(false);
      }
    }, "image/jpeg", 0.9);
  };

  const stopCamera = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setShowCamera(false);
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Avatar */}
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: photoUrl ? "transparent" : `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.3, fontWeight: 700, color: "#fff",
        overflow: "hidden", border: `2px solid ${C.border}`, flexShrink: 0,
      }}>
        {photoUrl
          ? <img src={photoUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : initials}
      </div>

      {/* Edit controls */}
      {editable && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => fileRef.current?.click()} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "4px 10px", fontSize: 11, color: C.textMuted, cursor: "pointer", fontFamily: "inherit",
            }}>
              {uploading ? "Uploading…" : "📁 Upload"}
            </button>
            <button onClick={startCamera} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "4px 10px", fontSize: 11, color: C.textMuted, cursor: "pointer", fontFamily: "inherit",
            }}>📷 Camera</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
        </div>
      )}

      {/* Camera modal */}
      {showCamera && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 400,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: 320, height: 240, borderRadius: 10, border: `2px solid ${C.border}` }} />
          <div style={{ display: "flex", gap: 12 }}>
            <Btn onClick={capturePhoto} variant="primary">📸 Capture</Btn>
            <Btn onClick={stopCamera} variant="danger">Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Patient Form Component ───────────────────────────────────────────────────

function PatientFormPanel({ initial, onSave, onCancel, saving, title }: {
  initial: PatientForm; onSave: (form: PatientForm, photoUrl: string | null) => Promise<void>;
  onCancel: () => void; saving: boolean; title: string;
}) {
  const [form, setForm] = useState<PatientForm>(initial);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  function setF(key: keyof PatientForm, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  // Auto-calc when ft/in changes
  const onHeightFtChange = (v: string) => {
    setF("height_ft", v);
    const cm = ftInToCm(parseInt(v) || 0, parseInt(form.height_in) || 0);
    setF("height_cm", cm > 0 ? String(cm) : "");
  };
  const onHeightInChange = (v: string) => {
    setF("height_in", v);
    const cm = ftInToCm(parseInt(form.height_ft) || 0, parseInt(v) || 0);
    setF("height_cm", cm > 0 ? String(cm) : "");
  };
  const onHeightCmChange = (v: string) => {
    setF("height_cm", v);
    const { ft, inches } = cmToFtIn(parseFloat(v) || 0);
    setF("height_ft", String(ft));
    setF("height_in", String(inches));
  };
  const onWeightLbsChange = (v: string) => {
    setF("weight_lbs", v);
    setF("weight_kg", String(lbsToKg(parseFloat(v) || 0)));
  };
  const onWeightKgChange = (v: string) => {
    setF("weight_kg", v);
    setF("weight_lbs", String(kgToLbs(parseFloat(v) || 0)));
  };

  const heightCm = parseFloat(form.height_cm) || 0;
  const weightKg = parseFloat(form.weight_kg) || 0;
  const bmi = heightCm > 0 && weightKg > 0 ? calcBMI(heightCm, weightKg) : null;
  const bmiInfo = bmi ? bmiCategory(bmi) : null;
  const age = form.date_of_birth ? calcAge(form.date_of_birth) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h3>

      {/* Photo */}
      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <PatientPhoto
          photoUrl={photoUrl}
          name={`${form.first_name} ${form.last_name}`.trim() || "Patient"}
          size={80}
          editable
          onUpload={setPhotoUrl}
        />
      </div>

      <SectionHeader title="Personal Information" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="First Name">
          <Input value={form.first_name} onChange={v => setF("first_name", v)} placeholder="Jane" />
        </Field>
        <Field label="Last Name">
          <Input value={form.last_name} onChange={v => setF("last_name", v)} placeholder="Smith" />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "end" }}>
        <Field label="Date of Birth">
          <Input type="date" value={form.date_of_birth} onChange={v => setF("date_of_birth", v)} />
        </Field>
        {age !== null && (
          <div style={{ background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Age</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: C.blue }}>{age}</div>
          </div>
        )}
      </div>

      {/* Height */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Height</label>
          <UnitToggle value={form.height_unit} options={["cm", "ft"]} onChange={v => setF("height_unit", v as "cm" | "ft")} />
        </div>
        {form.height_unit === "cm" ? (
          <Input type="number" value={form.height_cm} onChange={onHeightCmChange} placeholder="167" min={50} max={250} />
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <Input type="number" value={form.height_ft} onChange={onHeightFtChange} placeholder="5" min={1} max={8}
              style={{ flex: 1 }} />
            <span style={{ color: C.textMuted, alignSelf: "center", fontSize: 14 }}>ft</span>
            <Input type="number" value={form.height_in} onChange={onHeightInChange} placeholder="6" min={0} max={11}
              style={{ flex: 1 }} />
            <span style={{ color: C.textMuted, alignSelf: "center", fontSize: 14 }}>in</span>
          </div>
        )}
        {heightCm > 0 && (
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
            {form.height_unit === "cm"
              ? `${cmToFtIn(heightCm).ft}′ ${cmToFtIn(heightCm).inches}″`
              : `${heightCm} cm`}
          </div>
        )}
      </div>

      {/* Weight */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Weight</label>
          <UnitToggle value={form.weight_unit} options={["kg", "lbs"]} onChange={v => setF("weight_unit", v as "kg" | "lbs")} />
        </div>
        {form.weight_unit === "kg" ? (
          <Input type="number" value={form.weight_kg} onChange={onWeightKgChange} placeholder="64" min={20} max={300} />
        ) : (
          <Input type="number" value={form.weight_lbs} onChange={onWeightLbsChange} placeholder="142" min={44} max={660} />
        )}
        {weightKg > 0 && (
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
            {form.weight_unit === "kg" ? `${kgToLbs(weightKg)} lbs` : `${weightKg} kg`}
          </div>
        )}
      </div>

      {/* BMI */}
      {bmi && bmiInfo && (
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          background: bmiInfo.color + "15", border: `1px solid ${bmiInfo.color}30`,
          borderRadius: 8, padding: "12px 16px",
        }}>
          <div>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>BMI</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: bmiInfo.color }}>{bmi}</div>
          </div>
          <div>
            <Badge label={bmiInfo.label} color={bmiInfo.color} />
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              {heightCm}cm · {weightKg}kg
            </div>
          </div>
        </div>
      )}

      <SectionHeader title="Clinical" />
      <Field label="Patient Type">
        <Select value={form.patient_type} onChange={v => setF("patient_type", v)}>
          <option value="general_fitness">General Fitness</option>
          <option value="post_surgery">Post Surgery</option>
          <option value="elderly">Elderly</option>
          <option value="pediatric">Pediatric</option>
        </Select>
      </Field>
      <Field label="Condition Notes" hint="Diagnosis, relevant history">
        <Textarea value={form.condition_notes} onChange={v => setF("condition_notes", v)} rows={3}
          placeholder="e.g. Rotator cuff repair, 6 weeks post-op" />
      </Field>
      <Field label="Goals">
        <Textarea value={form.goals} onChange={v => setF("goals", v)} rows={2}
          placeholder="e.g. Restore full shoulder range of motion" />
      </Field>

      <div style={{ display: "flex", gap: 10, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
        <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
        <Btn onClick={() => onSave(form, photoUrl)} variant="primary" disabled={saving} fullWidth>
          {saving ? "Saving…" : "Save Patient"}
        </Btn>
      </div>
    </div>
  );
}

// ─── Patient Profile Slide-out Panel ─────────────────────────────────────────

function PatientProfilePanel({ patient, sessions, onClose, onEdit, onDelete }: {
  patient: Patient;
  sessions: SavedSession[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const age = patient.date_of_birth ? calcAge(patient.date_of_birth) : null;
  const bmi = patient.height_cm && patient.weight_kg ? calcBMI(patient.height_cm, patient.weight_kg) : null;
  const bmiInfo = bmi ? bmiCategory(bmi) : null;
  const patientSessions = sessions.filter(s => s.patient_id === patient.id);
  const completedSessions = patientSessions.filter(s => s.status === "completed");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
      display: "flex", justifyContent: "flex-end",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "min(520px, 100vw)", height: "100vh",
        background: C.surface, borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <PatientPhoto photoUrl={patient.photo_url} name={patient.full_name} size={56} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{patient.full_name}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" as const }}>
              <Badge label={PATIENT_TYPE_LABELS[patient.patient_type] ?? patient.patient_type}
                color={PATIENT_TYPE_COLORS[patient.patient_type] ?? C.blue} />
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

          {/* Stats row */}
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

          {/* Physical stats */}
          {(patient.height_cm || patient.weight_kg || patient.date_of_birth) && (
            <div style={{ marginBottom: 20 }}>
              <SectionHeader title="Physical" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {patient.date_of_birth && (
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Date of Birth</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>{formatDate(patient.date_of_birth)}</div>
                    {age !== null && <div style={{ fontSize: 12, color: C.textMuted }}>Age {age}</div>}
                  </div>
                )}
                {patient.height_cm && (
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Height</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>{patient.height_cm} cm</div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>{cmToFtIn(patient.height_cm).ft}′ {cmToFtIn(patient.height_cm).inches}″</div>
                  </div>
                )}
                {patient.weight_kg && (
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Weight</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>{patient.weight_kg} kg</div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>{kgToLbs(patient.weight_kg)} lbs</div>
                  </div>
                )}
                {bmi && bmiInfo && (
                  <div style={{ background: bmiInfo.color + "15", border: `1px solid ${bmiInfo.color}30`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>BMI</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: bmiInfo.color, marginTop: 2 }}>{bmi} · {bmiInfo.label}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Clinical */}
          {(patient.condition_notes || patient.goals) && (
            <div style={{ marginBottom: 20 }}>
              <SectionHeader title="Clinical" />
              {patient.condition_notes && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 4 }}>Condition</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{patient.condition_notes}</div>
                </div>
              )}
              {patient.goals && (
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 4 }}>Goals</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{patient.goals}</div>
                </div>
              )}
            </div>
          )}

          {/* Sessions */}
          <div>
            <SectionHeader title={`Sessions (${patientSessions.length})`} />
            {patientSessions.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textDim, padding: "16px 0", textAlign: "center" }}>
                No sessions assigned yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {patientSessions.map(s => (
                  <div key={s.id} style={{
                    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: C.textDim }}>
                        {s.exercises.length} exercise{s.exercises.length !== 1 ? "s" : ""} · {s.estimated_duration_mins} min · {formatDate(s.created_at)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Badge label={s.status} color={s.status === "completed" ? C.green : s.status === "pending" ? C.blue : C.textMuted} />
                      <Btn onClick={() => window.open(`/session?prescription=${s.id}`, "_blank")} small>▶ Run</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
          <Btn onClick={onEdit} variant="primary">Edit Profile</Btn>
          <Btn onClick={onDelete} variant="danger">Delete Patient</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Patients Tab ─────────────────────────────────────────────────────────────

function PatientsTab({ showToast, sessions }: { showToast: (msg: string, ok?: boolean) => void; sessions: SavedSession[] }) {
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
    const { data } = await supabase.from("patients_mvp").select("*").order("created_at", { ascending: false });
    if (data) {
      setPatients(data.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        first_name: (p.first_name as string) ?? "",
        last_name: (p.last_name as string) ?? "",
        full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || (p.full_name as string) ?? "Unknown",
        patient_type: p.patient_type as string,
        condition_notes: p.condition_notes as string | null,
        goals: p.goals as string | null,
        date_of_birth: p.date_of_birth as string | null,
        height_cm: p.height_cm as number | null,
        weight_kg: p.weight_kg as number | null,
        photo_url: p.photo_url as string | null,
        created_at: p.created_at as string,
      })));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  const handleSave = async (form: PatientForm, photoUrl: string | null) => {
    if (!form.first_name.trim()) { showToast("First name is required.", false); return; }
    setSaving(true);
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`.trim(),
        patient_type: form.patient_type,
        date_of_birth: form.date_of_birth || null,
        condition_notes: form.condition_notes || null,
        goals: form.goals || null,
        height_cm: parseFloat(form.height_cm) || null,
        weight_kg: parseFloat(form.weight_kg) || null,
        photo_url: photoUrl ?? (mode === "edit" ? selectedPatient?.photo_url : null),
        consent_given_at: new Date().toISOString(),
      };

      if (mode === "edit" && selectedPatient) {
        const { error } = await supabase.from("patients_mvp").update(payload).eq("id", selectedPatient.id);
        if (error) throw error;
        showToast("Patient updated.");
      } else {
        const { error } = await supabase.from("patients_mvp").insert(payload);
        if (error) throw error;
        showToast(`Patient "${payload.full_name}" registered.`);
      }

      setMode("list");
      setSelectedPatient(null);
      loadPatients();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to save patient.", false);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: Patient) => {
    const ftIn = p.height_cm ? cmToFtIn(p.height_cm) : { ft: 0, inches: 0 };
    setEditForm({
      first_name: p.first_name, last_name: p.last_name,
      date_of_birth: p.date_of_birth ?? "", patient_type: p.patient_type,
      condition_notes: p.condition_notes ?? "", goals: p.goals ?? "",
      height_cm: p.height_cm ? String(p.height_cm) : "",
      weight_kg: p.weight_kg ? String(p.weight_kg) : "",
      height_ft: String(ftIn.ft), height_in: String(ftIn.inches),
      weight_lbs: p.weight_kg ? String(kgToLbs(p.weight_kg)) : "",
      height_unit: "cm", weight_unit: "kg",
    });
    setSelectedPatient(p);
    setViewingPatient(null);
    setMode("edit");
  };

  const handleDelete = async (p: Patient) => {
    if (!confirm(`Delete patient "${p.full_name}"?`)) return;
    await supabase.from("patients_mvp").delete().eq("id", p.id);
    showToast("Patient deleted.");
    setViewingPatient(null);
    loadPatients();
  };

  return (
    <div>
      {/* List view */}
      {mode === "list" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Patients</h2>
              <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>{patients.length} registered</p>
            </div>
            <Btn variant="primary" onClick={() => { setMode("create"); setEditForm(emptyForm()); }}>+ Register Patient</Btn>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted, fontSize: 14 }}>Loading…</div>
          ) : patients.length === 0 ? (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>No patients yet</div>
              <div style={{ fontSize: 13, color: C.textMuted }}>Register your first patient to get started.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
              {patients.map(p => {
                const age = p.date_of_birth ? calcAge(p.date_of_birth) : null;
                const bmi = p.height_cm && p.weight_kg ? calcBMI(p.height_cm, p.weight_kg) : null;
                const bmiInfo = bmi ? bmiCategory(bmi) : null;
                const patientSessions = sessions.filter(s => s.patient_id === p.id);
                return (
                  <div key={p.id} onClick={() => setViewingPatient(p)} style={{
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: "16px", cursor: "pointer", transition: "border-color 0.15s",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus + "60")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                  >
                    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <PatientPhoto photoUrl={p.photo_url} name={p.full_name} size={52} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>{p.full_name}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
                          <Badge label={PATIENT_TYPE_LABELS[p.patient_type] ?? p.patient_type} color={PATIENT_TYPE_COLORS[p.patient_type] ?? C.blue} />
                          {age !== null && <Badge label={`Age ${age}`} color={C.textMuted} />}
                          {bmiInfo && <Badge label={`BMI ${bmi}`} color={bmiInfo.color} />}
                        </div>
                        {/* Physical stats */}
                        {(p.height_cm || p.weight_kg) && (
                          <div style={{ fontSize: 12, color: C.textMuted, display: "flex", gap: 12, marginBottom: 6 }}>
                            {p.height_cm && <span>{p.height_cm}cm ({cmToFtIn(p.height_cm).ft}′{cmToFtIn(p.height_cm).inches}″)</span>}
                            {p.weight_kg && <span>{p.weight_kg}kg ({kgToLbs(p.weight_kg)}lbs)</span>}
                          </div>
                        )}
                        {p.condition_notes && (
                          <div style={{ fontSize: 12, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                            {p.condition_notes}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
                          {patientSessions.length} session{patientSessions.length !== 1 ? "s" : ""}
                          {patientSessions.length > 0 && ` · ${patientSessions.filter(s => s.status === "completed").length} completed`}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit form */}
      {(mode === "create" || mode === "edit") && (
        <div style={{ maxWidth: 560 }}>
          <PatientFormPanel
            initial={editForm}
            onSave={handleSave}
            onCancel={() => { setMode("list"); setSelectedPatient(null); }}
            saving={saving}
            title={mode === "create" ? "Register New Patient" : `Edit — ${selectedPatient?.full_name}`}
          />
        </div>
      )}

      {/* Profile slide-out */}
      {viewingPatient && (
        <PatientProfilePanel
          patient={viewingPatient}
          sessions={sessions}
          onClose={() => setViewingPatient(null)}
          onEdit={() => startEdit(viewingPatient)}
          onDelete={() => handleDelete(viewingPatient)}
        />
      )}
    </div>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab({ showToast, patients }: { showToast: (msg: string, ok?: boolean) => void; patients: Patient[] }) {
  const supabase = getSupabaseClient();
  const [templates, setTemplates] = useState<ExerciseTemplate[]>([]);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("New Session");
  const [sessionObjective, setSessionObjective] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("none");
  const [estimatedMins, setEstimatedMins] = useState("10");
  const [exercises, setExercises] = useState<SessionExercise[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: tmpl }, { data: sess }] = await Promise.all([
      supabase.from("exercise_templates").select("*").order("display_name"),
      supabase.from("session_prescriptions")
        .select("*, prescription_exercises(*, exercise_templates(display_name, default_reps, default_hold_ms))")
        .order("created_at", { ascending: false }),
    ]);
    if (tmpl) { setTemplates(tmpl); if (tmpl.length > 0) setSelectedTemplateId(tmpl[0].id); }
    if (sess) {
      setSessions(sess.map((s: Record<string, unknown>) => {
        const pe = (s.prescription_exercises as Array<Record<string, unknown>>) ?? [];
        return {
          id: s.id as string, title: s.title as string,
          objective: s.objective as string | null,
          patient_id: s.patient_id as string | null,
          status: s.status as string,
          estimated_duration_mins: s.estimated_duration_mins as number,
          created_at: s.created_at as string,
          exercises: pe.sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number)).map(e => ({
            template_id: e.template_id as string,
            display_name: (e.exercise_templates as { display_name: string } | null)?.display_name ?? "Unknown",
            reps: (e.reps_override as number) ?? (e.exercise_templates as { default_reps: number } | null)?.default_reps ?? 6,
            hold_ms: (e.hold_ms_override as number) ?? (e.exercise_templates as { default_hold_ms: number } | null)?.default_hold_ms ?? 2000,
            sequence_order: e.sequence_order as number,
          })),
        };
      }));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const addExercise = () => {
    const tmpl = templates.find(t => t.id === selectedTemplateId);
    if (!tmpl) return;
    setExercises(prev => [...prev, { template_id: tmpl.id, display_name: tmpl.display_name, reps: tmpl.default_reps, hold_ms: tmpl.default_hold_ms, sequence_order: prev.length }]);
  };

  const removeExercise = (idx: number) => setExercises(prev => prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, sequence_order: i })));

  const moveExercise = (idx: number, dir: -1 | 1) => {
    const newEx = [...exercises]; const swap = idx + dir;
    if (swap < 0 || swap >= newEx.length) return;
    [newEx[idx], newEx[swap]] = [newEx[swap], newEx[idx]];
    setExercises(newEx.map((e, i) => ({ ...e, sequence_order: i })));
  };

  const updateExercise = (idx: number, key: "reps" | "hold_ms", value: number) =>
    setExercises(prev => prev.map((e, i) => i === idx ? { ...e, [key]: value } : e));

  const saveSession = async (testMode = false) => {
    if (!sessionTitle.trim()) { showToast("Session title is required.", false); return; }
    if (exercises.length === 0) { showToast("Add at least one exercise.", false); return; }
    setSaving(true);
    try {
      const { data: prescription, error: pErr } = await supabase
        .from("session_prescriptions")
        .insert({ title: sessionTitle, objective: sessionObjective || null, patient_id: selectedPatientId === "none" ? null : selectedPatientId, physio_id: null, estimated_duration_mins: parseInt(estimatedMins) || 10, status: "pending" })
        .select().single();
      if (pErr) throw pErr;
      const { error: eErr } = await supabase.from("prescription_exercises").insert(
        exercises.map((e, i) => ({ prescription_id: prescription.id, template_id: e.template_id, sequence_order: i, reps_override: e.reps, hold_ms_override: e.hold_ms }))
      );
      if (eErr) throw eErr;
      showToast("Session saved.");
      if (testMode) window.open(`/session?prescription=${prescription.id}`, "_blank");
      setSessionTitle("New Session"); setSessionObjective(""); setSelectedPatientId("none"); setExercises([]);
      loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to save session.", false);
    } finally { setSaving(false); }
  };

  const deleteSession = async (id: string) => {
    if (!confirm("Delete this session?")) return;
    await supabase.from("prescription_exercises").delete().eq("prescription_id", id);
    await supabase.from("session_prescriptions").delete().eq("id", id);
    showToast("Session deleted."); loadData();
  };

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted, fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, alignItems: "start" }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Session Builder</h2>
        <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 20px" }}>Build a session from the exercise library and assign to a patient.</p>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionHeader title="Session Details" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Session Title"><Input value={sessionTitle} onChange={setSessionTitle} placeholder="Shoulder Recovery Week 1" /></Field>
            <Field label="Duration (mins)"><Input type="number" value={estimatedMins} onChange={setEstimatedMins} min={1} max={60} /></Field>
          </div>
          <Field label="Objective"><Input value={sessionObjective} onChange={setSessionObjective} placeholder="e.g. Build shoulder strength and range of motion" /></Field>
          <Field label="Assign to Patient" hint="Optional — skip for test sessions">
            <Select value={selectedPatientId} onChange={setSelectedPatientId}>
              <option value="none">— Test Mode (no patient) —</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.full_name} · {PATIENT_TYPE_LABELS[p.patient_type] ?? p.patient_type}</option>)}
            </Select>
          </Field>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <SectionHeader title="Add Exercises" />
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <Select value={selectedTemplateId} onChange={setSelectedTemplateId}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.display_name} · {t.default_reps} reps · {msToSeconds(t.default_hold_ms)}s hold</option>)}
                </Select>
              </div>
              <Btn onClick={addExercise} variant="primary">+ Add</Btn>
            </div>
            {exercises.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: C.textDim, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>No exercises added yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {exercises.map((ex, idx) => (
                  <div key={idx} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
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
                              onChange={e => updateExercise(idx, key as "reps" | "hold_ms", key === "hold_ms" ? secondsToMs(e.target.value) : parseInt(e.target.value) || 1)}
                              style={{ width: 52, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          </div>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => removeExercise(idx)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: 4, opacity: 0.7 }}>✕</button>
                  </div>
                ))}
                <div style={{ background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: C.blue, marginTop: 4 }}>
                  {exercises.length} exercise{exercises.length !== 1 ? "s" : ""} · est. {estimatedMins} min
                  {selectedPatientId !== "none" && ` · ${patients.find(p => p.id === selectedPatientId)?.full_name ?? ""}`}
                </div>
              </div>
            )}
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: "flex", gap: 10 }}>
            <Btn onClick={() => saveSession(false)} variant="ghost" disabled={saving}>Save Session</Btn>
            <Btn onClick={() => saveSession(true)} variant="primary" disabled={saving}>{saving ? "Saving…" : "⚡ Save + Test Now"}</Btn>
            <Btn onClick={() => { setExercises([]); setSessionTitle("New Session"); setSessionObjective(""); setSelectedPatientId("none"); }} variant="danger" small>Clear</Btn>
          </div>
          <p style={{ fontSize: 11, color: C.textDim, margin: 0 }}>"Save + Test Now" opens the session runner in a new tab immediately.</p>
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Saved Sessions</h2>
        <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 20px" }}>{sessions.length} sessions</p>
        {sessions.length === 0 ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "32px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, color: C.textMuted }}>No sessions yet.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sessions.map(s => {
              const assignedPatient = patients.find(p => p.id === s.patient_id);
              return (
                <div key={s.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.title}</div>
                      {s.objective && <div style={{ fontSize: 12, color: C.textMuted }}>{s.objective}</div>}
                      <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                        {s.exercises.length} exercise{s.exercises.length !== 1 ? "s" : ""} · {s.estimated_duration_mins} min
                        {assignedPatient ? ` · ${assignedPatient.full_name}` : " · Test session"}
                      </div>
                    </div>
                    <Badge label={s.status} color={s.status === "completed" ? C.green : s.status === "pending" ? C.blue : C.textMuted} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {s.exercises.map((ex, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
                        <span style={{ color: C.textDim, minWidth: 16 }}>{i + 1}.</span>
                        <span style={{ flex: 1, color: C.text }}>{ex.display_name}</span>
                        <span>{ex.reps}× · {msToSeconds(ex.hold_ms)}s</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                    <Btn onClick={() => window.open(`/session?prescription=${s.id}`, "_blank")} variant="primary" small>▶ Run</Btn>
                    <Btn onClick={() => deleteSession(s.id)} variant="danger" small>Delete</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Exercise Library Tab ─────────────────────────────────────────────────────

function ExerciseLibraryTab({ showToast }: { showToast: (msg: string, ok?: boolean) => void }) {
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
        if (error) throw error;
        showToast("Exercise created in My Library.");
      } else {
        const { error } = await supabase.from("exercise_templates").update(payload).eq("id", template.id);
        if (error) throw error;
        showToast("Exercise updated.");
      }
      setEditingTemplate(null); loadTemplates();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Save failed.", false);
    } finally { setSaving(false); }
  };

  const raw = subTab === "vanilla" ? vanillaTemplates : myTemplates;
  const active = raw.filter(t => {
    const ms = search === "" || t.display_name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? "").toLowerCase().includes(search.toLowerCase());
    const mt = typeFilter === "all" || t.exercise_type === typeFilter;
    return ms && mt;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 2, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 16 }}>
        {[{ key: "vanilla", label: `System (${vanillaTemplates.length})` }, { key: "mine", label: `My Library (${myTemplates.length})` }].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key as "vanilla" | "mine")} style={{
            background: subTab === key ? C.surfaceHover : "transparent",
            border: `1px solid ${subTab === key ? C.border : "transparent"}`,
            borderRadius: 6, padding: "6px 16px", color: subTab === key ? C.text : C.textMuted,
            fontSize: 13, fontWeight: subTab === key ? 600 : 400, fontFamily: "inherit", cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" as const }}>
        <input type="text" placeholder="Search exercises…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: typeFilter === "all" ? C.textMuted : C.text, fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
          <option value="all">All types</option>
          <option value="arm_raise">Arm Raise</option>
          <option value="bilateral_arm_raise">Bilateral Arm Raise</option>
          <option value="sit_to_stand">Sit to Stand</option>
          <option value="custom">Custom</option>
        </select>
        {(search || typeFilter !== "all") && (
          <button onClick={() => { setSearch(""); setTypeFilter("all"); }} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.textMuted, fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Clear</button>
        )}
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted, fontSize: 14 }}>Loading…</div>
      ) : active.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{subTab === "vanilla" ? "📋" : "🗂️"}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            {search || typeFilter !== "all" ? "No matching exercises" : subTab === "vanilla" ? "No system templates found" : "No custom exercises yet"}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16 }}>
          {active.map(t => (
            <div key={t.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, transition: "border-color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus + "60")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{t.display_name}</span>
                    <Badge label={t.exercise_type.replace(/_/g, " ")} color={EXERCISE_TYPE_COLOR[t.exercise_type] ?? C.textMuted} />
                    {t.is_vanilla && <Badge label="System" color={C.textMuted} />}
                  </div>
                  <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>{t.description ?? "No description."}</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
                {[["Reps", t.default_reps], ["Hold", `${msToSeconds(t.default_hold_ms)}s`], ["Target", `${t.target_metric_degrees}°`]].map(([l, v]) => (
                  <div key={String(l)} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{l}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{v}</span>
                  </div>
                ))}
              </div>
              {t.clinical_objective && <div style={{ background: C.greenDim, border: `1px solid ${C.green}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: C.green, lineHeight: 1.5 }}>🎯 {t.clinical_objective}</div>}
              <div style={{ display: "flex", gap: 8, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
                <Btn onClick={() => setEditingTemplate({ ...t })} small>{t.is_vanilla ? "View / Edit" : "Edit"}</Btn>
                <Btn onClick={() => setEditingTemplate({ ...t, id: "", is_vanilla: false, display_name: `${t.display_name} (Custom)`, created_by: null })} small>Clone</Btn>
                {!t.is_vanilla && <div style={{ marginLeft: "auto" }}><Btn onClick={async () => { if (confirm(`Delete "${t.display_name}"?`)) { await supabase.from("exercise_templates").delete().eq("id", t.id); showToast("Exercise deleted."); loadTemplates(); } }} variant="danger" small>Delete</Btn></div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editingTemplate && (
        <ExerciseEditor template={editingTemplate} onSave={handleSave} onClose={() => setEditingTemplate(null)} saving={saving} />
      )}
    </div>
  );
}

function ExerciseEditor({ template, onSave, onClose, saving }: {
  template: ExerciseTemplate; onSave: (t: ExerciseTemplate) => Promise<void>; onClose: () => void; saving: boolean;
}) {
  const [form, setForm] = useState<ExerciseTemplate>({ ...template });
  function setField<K extends keyof ExerciseTemplate>(key: K, value: ExerciseTemplate[K]) { setForm(f => ({ ...f, [key]: value })); }
  function setCoaching(key: keyof CoachingStrings, value: string | string[]) { setForm(f => ({ ...f, coaching_strings: { ...f.coaching_strings, [key]: value } })); }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(680px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{template.is_vanilla ? "Clone Exercise" : "Edit Exercise"}</div></div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Display Name"><Input value={form.display_name} onChange={v => setField("display_name", v)} /></Field>
            <Field label="Description"><Textarea value={form.description ?? ""} onChange={v => setField("description", v)} /></Field>
            <Field label="Clinical Objective"><Textarea value={form.clinical_objective ?? ""} onChange={v => setField("clinical_objective", v)} rows={2} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Repetitions"><Input type="number" value={form.default_reps} min={1} max={30} onChange={v => setField("default_reps", parseInt(v) || 1)} /></Field>
              <Field label="Hold (seconds)"><Input type="number" value={msToSeconds(form.default_hold_ms)} min={0} max={10} step={0.5} onChange={v => setField("default_hold_ms", secondsToMs(v))} /></Field>
              <Field label="Rest (seconds)"><Input type="number" value={msToSeconds(form.default_rest_ms)} min={0} max={10} step={0.5} onChange={v => setField("default_rest_ms", secondsToMs(v))} /></Field>
              <Field label="Target Angle (°)"><Input type="number" value={form.target_metric_degrees} min={10} max={180} onChange={v => setField("target_metric_degrees", parseFloat(v) || 70)} /></Field>
            </div>
            <Field label="Exercise Intro"><Textarea value={form.coaching_strings.intro} rows={2} onChange={v => setCoaching("intro", v)} /></Field>
            <Field label="Hold Cues (one per line)">
              <Textarea value={Array.isArray(form.coaching_strings.hold) ? form.coaching_strings.hold.join("\n") : form.coaching_strings.hold} rows={5} onChange={v => setCoaching("hold", v.split("\n").filter(Boolean))} />
            </Field>
            <Field label="Lower Cue"><Input value={form.coaching_strings.lower} onChange={v => setCoaching("lower", v)} /></Field>
            {[["correction_height", "Height Correction"], ["correction_hold", "Hold Correction"], ["correction_balance", "Balance Correction"], ["exercise_complete", "Exercise Complete"]].map(([key, label]) => (
              <Field key={key} label={label}><Input value={(form.coaching_strings as unknown as Record<string, string>)[key] ?? ""} onChange={v => setCoaching(key as keyof CoachingStrings, v)} /></Field>
            ))}
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn onClick={onClose} variant="ghost">Cancel</Btn>
          <Btn onClick={() => onSave(form)} variant="primary" disabled={saving}>{saving ? "Saving…" : template.is_vanilla ? "Save as New Template" : "Save Changes"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "library" | "patients" | "sessions";

export default function AdminPage() {
  const supabase = getSupabaseClient();
  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [allSessions, setAllSessions] = useState<SavedSession[]>([]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // Load shared data (patients + sessions) for cross-tab use
  const loadShared = useCallback(async () => {
    const [{ data: pts }, { data: sess }] = await Promise.all([
      supabase.from("patients_mvp").select("*"),
      supabase.from("session_prescriptions")
        .select("*, prescription_exercises(*, exercise_templates(display_name, default_reps, default_hold_ms))"),
    ]);
    if (pts) {
      setAllPatients(pts.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        first_name: (p.first_name as string) ?? "",
        last_name: (p.last_name as string) ?? "",
        full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || (p.full_name as string) ?? "",
        patient_type: p.patient_type as string,
        condition_notes: p.condition_notes as string | null,
        goals: p.goals as string | null,
        date_of_birth: p.date_of_birth as string | null,
        height_cm: p.height_cm as number | null,
        weight_kg: p.weight_kg as number | null,
        photo_url: p.photo_url as string | null,
        created_at: p.created_at as string,
      })));
    }
    if (sess) {
      setAllSessions(sess.map((s: Record<string, unknown>) => {
        const pe = (s.prescription_exercises as Array<Record<string, unknown>>) ?? [];
        return {
          id: s.id as string, title: s.title as string,
          objective: s.objective as string | null,
          patient_id: s.patient_id as string | null,
          status: s.status as string,
          estimated_duration_mins: s.estimated_duration_mins as number,
          created_at: s.created_at as string,
          exercises: pe.sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number)).map(e => ({
            template_id: e.template_id as string,
            display_name: (e.exercise_templates as { display_name: string } | null)?.display_name ?? "Unknown",
            reps: (e.reps_override as number) ?? 6,
            hold_ms: (e.hold_ms_override as number) ?? 2000,
            sequence_order: e.sequence_order as number,
          })),
        };
      }));
    }
  }, [supabase]);

  useEffect(() => { loadShared(); }, [loadShared]);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "library",  label: "Exercise Library", icon: "🏋️" },
    { key: "patients", label: "Patients",          icon: "👤" },
    { key: "sessions", label: "Sessions",          icon: "📋" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 32px", display: "flex", alignItems: "center", height: 56, position: "sticky", top: 0, background: C.bg, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 32 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>AI Physio</span>
          <span style={{ color: C.border, fontSize: 16, margin: "0 4px" }}>|</span>
          <span style={{ fontSize: 14, color: C.textMuted }}>Admin</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(({ key, label, icon }) => (
            <button key={key} onClick={() => { setActiveTab(key); loadShared(); }} style={{
              background: activeTab === key ? C.surfaceHover : "transparent",
              border: "none", borderBottom: activeTab === key ? `2px solid ${C.blue}` : "2px solid transparent",
              padding: "0 16px", height: 56, color: activeTab === key ? C.text : C.textMuted,
              fontSize: 13, fontWeight: activeTab === key ? 600 : 400, fontFamily: "inherit",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s",
            }}>
              <span>{icon}</span> {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <a href="/session" target="_blank" style={{ fontSize: 12, color: C.blue, textDecoration: "none", padding: "6px 12px", border: `1px solid ${C.blue}40`, borderRadius: 6 }}>▶ Open Session Runner</a>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px" }}>
        {activeTab === "library"  && <ExerciseLibraryTab showToast={showToast} />}
        {activeTab === "patients" && <PatientsTab showToast={showToast} sessions={allSessions} />}
        {activeTab === "sessions" && <SessionsTab showToast={showToast} patients={allPatients} />}
      </div>

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  );
}
