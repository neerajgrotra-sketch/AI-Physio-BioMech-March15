"use client";

// app/admin/page.tsx
// Physio admin — Exercise Library + Patients + Sessions
// Three-tab layout. No auth required for MVP testing.

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ExerciseTemplate, CoachingStrings } from "@/lib/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Patient {
  id: string;
  full_name: string;
  patient_type: string;
  condition_notes: string | null;
  date_of_birth: string | null;
  created_at: string;
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
  patient_name?: string;
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

const EXERCISE_TYPE_COLOR: Record<string, string> = {
  arm_raise:           C.blue,
  bilateral_arm_raise: C.purple,
  sit_to_stand:        C.green,
  custom:              C.orange,
};

// ─── Shared UI components ─────────────────────────────────────────────────────

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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: C.textDim, margin: 0 }}>{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder, min, max, step }: {
  value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder}
      min={min} max={max} step={step}
      onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit",
        outline: "none", width: "100%", boxSizing: "border-box" as const,
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
    <textarea value={value} rows={rows} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
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

function Select({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: "8px 12px", color: C.text, fontSize: 14, fontFamily: "inherit",
        outline: "none", width: "100%", cursor: "pointer",
      }}
    >{children}</select>
  );
}

function Btn({ children, onClick, variant = "ghost", disabled, small, fullWidth }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "success"; disabled?: boolean; small?: boolean; fullWidth?: boolean;
}) {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    primary: { bg: C.blue,  color: "#fff",    border: C.blue },
    ghost:   { bg: "transparent", color: C.text, border: C.border },
    danger:  { bg: "transparent", color: C.red,  border: C.red + "60" },
    success: { bg: C.green, color: "#fff",     border: C.green },
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

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 200,
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

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 style={{
      fontSize: 11, fontWeight: 700, color: C.textMuted,
      textTransform: "uppercase" as const, letterSpacing: "0.06em",
      margin: "0 0 14px", borderBottom: `1px solid ${C.border}`, paddingBottom: 8,
    }}>{title}</h3>
  );
}

// ─── Exercise Library Tab ─────────────────────────────────────────────────────

function msToSeconds(ms: number) { return (ms / 1000).toFixed(1); }
function secondsToMs(s: string) { return Math.round(parseFloat(s) * 1000); }

function ExerciseCard({ template, onEdit, onClone, onDelete }: {
  template: ExerciseTemplate; onEdit: () => void; onClone: () => void; onDelete?: () => void;
}) {
  const typeColor = EXERCISE_TYPE_COLOR[template.exercise_type] ?? C.textMuted;
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12,
      transition: "border-color 0.15s",
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus + "60")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{template.display_name}</span>
            <Badge label={template.exercise_type.replace(/_/g, " ")} color={typeColor} />
            {template.is_vanilla && <Badge label="System" color={C.textMuted} />}
            {template.bilateral && <Badge label="Bilateral" color={C.purple} />}
          </div>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
            {template.description ?? "No description."}
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
        {[
          { label: "Reps", value: template.default_reps },
          { label: "Hold", value: `${msToSeconds(template.default_hold_ms)}s` },
          { label: "Target", value: `${template.target_metric_degrees}°` },
          { label: "Rest", value: `${msToSeconds(template.default_rest_ms)}s` },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{value}</span>
          </div>
        ))}
      </div>
      {template.clinical_objective && (
        <div style={{ background: C.greenDim, border: `1px solid ${C.green}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: C.green, lineHeight: 1.5 }}>
          🎯 {template.clinical_objective}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
        <Btn onClick={onEdit} small>{template.is_vanilla ? "View / Edit" : "Edit"}</Btn>
        <Btn onClick={onClone} small>Clone</Btn>
        {!template.is_vanilla && onDelete && (
          <div style={{ marginLeft: "auto" }}>
            <Btn onClick={onDelete} variant="danger" small>Delete</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function ExerciseEditor({ template, onSave, onClose, saving }: {
  template: ExerciseTemplate; onSave: (t: ExerciseTemplate) => Promise<void>; onClose: () => void; saving: boolean;
}) {
  const [form, setForm] = useState<ExerciseTemplate>({ ...template });
  function setField<K extends keyof ExerciseTemplate>(key: K, value: ExerciseTemplate[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }
  function setCoaching(key: keyof CoachingStrings, value: string | string[]) {
    setForm(f => ({ ...f, coaching_strings: { ...f.coaching_strings, [key]: value } }));
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(680px, 100vw)", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{template.is_vanilla ? "Clone Exercise" : "Edit Exercise"}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              {template.is_vanilla ? "Configuring a copy — original unchanged." : `Editing: ${template.display_name}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section>
              <SectionHeader title="Identity" />
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Display Name"><Input value={form.display_name} onChange={v => setField("display_name", v)} /></Field>
                <Field label="Description"><Textarea value={form.description ?? ""} onChange={v => setField("description", v)} /></Field>
                <Field label="Clinical Objective"><Textarea value={form.clinical_objective ?? ""} onChange={v => setField("clinical_objective", v)} rows={2} /></Field>
              </div>
            </section>
            <section>
              <SectionHeader title="Movement Parameters" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Repetitions" hint="Reps per session">
                  <Input type="number" value={form.default_reps} min={1} max={30} onChange={v => setField("default_reps", parseInt(v) || 1)} />
                </Field>
                <Field label="Hold Duration (seconds)">
                  <Input type="number" value={msToSeconds(form.default_hold_ms)} min={0} max={10} step={0.5} onChange={v => setField("default_hold_ms", secondsToMs(v))} />
                </Field>
                <Field label="Rest Between Reps (seconds)">
                  <Input type="number" value={msToSeconds(form.default_rest_ms)} min={0} max={10} step={0.5} onChange={v => setField("default_rest_ms", secondsToMs(v))} />
                </Field>
                <Field label="Target Angle (degrees)" hint="Minimum angle for a valid rep">
                  <Input type="number" value={form.target_metric_degrees} min={10} max={180} onChange={v => setField("target_metric_degrees", parseFloat(v) || 70)} />
                </Field>
              </div>
            </section>
            <section>
              <SectionHeader title="Coaching Voice" />
              <p style={{ fontSize: 12, color: C.textDim, margin: "0 0 14px", lineHeight: 1.5 }}>Hold and Success cues rotate — one per line.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Exercise Intro"><Textarea value={form.coaching_strings.intro} rows={2} onChange={v => setCoaching("intro", v)} /></Field>
                <Field label="Hold Cues (one per line)">
                  <Textarea value={Array.isArray(form.coaching_strings.hold) ? form.coaching_strings.hold.join("\n") : form.coaching_strings.hold} rows={5}
                    onChange={v => setCoaching("hold", v.split("\n").filter(Boolean))} />
                </Field>
                <Field label="Lower Cue"><Input value={form.coaching_strings.lower} onChange={v => setCoaching("lower", v)} /></Field>
                <Field label="First Rep Success"><Input value={form.coaching_strings.success_first} onChange={v => setCoaching("success_first", v)} /></Field>
                <Field label="Success Cues (one per line)">
                  <Textarea value={Array.isArray(form.coaching_strings.success_rotating) ? form.coaching_strings.success_rotating.join("\n") : ""} rows={6}
                    onChange={v => setCoaching("success_rotating", v.split("\n").filter(Boolean))} />
                </Field>
                {[
                  ["correction_height", "Height Correction"],
                  ["correction_hold", "Hold Correction"],
                  ["correction_balance", "Balance Correction"],
                  ["correction_isolation", "Isolation Correction"],
                  ["exercise_complete", "Exercise Complete"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input value={(form.coaching_strings as unknown as Record<string, string>)[key] ?? ""} onChange={v => setCoaching(key as keyof CoachingStrings, v)} />
                  </Field>
                ))}
              </div>
            </section>
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn onClick={onClose} variant="ghost">Cancel</Btn>
          <Btn onClick={() => onSave(form)} variant="primary" disabled={saving}>
            {saving ? "Saving…" : template.is_vanilla ? "Save as New Template" : "Save Changes"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Patients Tab ─────────────────────────────────────────────────────────────

function PatientsTab({ showToast }: { showToast: (msg: string, ok?: boolean) => void }) {
  const supabase = getSupabaseClient();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "", date_of_birth: "", patient_type: "general_fitness", condition_notes: "", goals: "",
  });

  const loadPatients = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("patient_profiles")
      .select("*, profiles(full_name)")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setPatients(data.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        full_name: (p.profiles as { full_name: string } | null)?.full_name ?? "Unknown",
        patient_type: p.patient_type as string,
        condition_notes: p.condition_notes as string | null,
        date_of_birth: p.date_of_birth as string | null,
        created_at: p.created_at as string,
      })));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  const handleSave = async () => {
    if (!form.full_name.trim()) { showToast("Patient name is required.", false); return; }
    setSaving(true);
    try {
      // Insert into profiles first (no auth, so use a placeholder uuid)
      const tempId = crypto.randomUUID();
      const { error: profileError } = await supabase
        .from("profiles")
        .insert({ id: tempId, role: "patient", full_name: form.full_name.trim() });
      if (profileError) throw profileError;

      const { error: patientError } = await supabase
        .from("patient_profiles")
        .insert({
          id: tempId,
          patient_type: form.patient_type,
          date_of_birth: form.date_of_birth || null,
          condition_notes: form.condition_notes || null,
          goals: form.goals || null,
          consent_given_at: new Date().toISOString(),
          consent_version: "1.0",
        });
      if (patientError) throw patientError;

      showToast(`Patient "${form.full_name}" registered.`);
      setForm({ full_name: "", date_of_birth: "", patient_type: "general_fitness", condition_notes: "", goals: "" });
      setShowForm(false);
      loadPatients();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to save patient.", false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete patient "${name}"? This will also delete their session history.`)) return;
    await supabase.from("patient_profiles").delete().eq("id", id);
    await supabase.from("profiles").delete().eq("id", id);
    showToast("Patient deleted.");
    loadPatients();
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
      {/* Patient list */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Patients</h2>
            <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>{patients.length} registered</p>
          </div>
          <Btn variant="primary" onClick={() => setShowForm(v => !v)}>
            {showForm ? "Cancel" : "+ Register Patient"}
          </Btn>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted, fontSize: 14 }}>Loading…</div>
        ) : patients.length === 0 ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "48px 32px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>No patients yet</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>Register your first patient using the form.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {patients.map(p => (
              <div key={p.id} style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.full_name}</span>
                    <Badge label={PATIENT_TYPE_LABELS[p.patient_type] ?? p.patient_type} color={C.blue} />
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted, display: "flex", gap: 16 }}>
                    {p.date_of_birth && <span>DOB: {p.date_of_birth}</span>}
                    {p.condition_notes && <span style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.condition_notes}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                    ID: {p.id.slice(0, 8)}…
                  </div>
                </div>
                <Btn onClick={() => handleDelete(p.id, p.full_name)} variant="danger" small>Delete</Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Registration form */}
      {showForm && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Register Patient</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Full Name *">
              <Input value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} placeholder="Jane Smith" />
            </Field>
            <Field label="Date of Birth">
              <Input type="date" value={form.date_of_birth} onChange={v => setForm(f => ({ ...f, date_of_birth: v }))} />
            </Field>
            <Field label="Patient Type">
              <Select value={form.patient_type} onChange={v => setForm(f => ({ ...f, patient_type: v }))}>
                <option value="general_fitness">General Fitness</option>
                <option value="post_surgery">Post Surgery</option>
                <option value="elderly">Elderly</option>
                <option value="pediatric">Pediatric</option>
              </Select>
            </Field>
            <Field label="Condition Notes" hint="Diagnosis, relevant history">
              <Textarea value={form.condition_notes} onChange={v => setForm(f => ({ ...f, condition_notes: v }))} rows={3} placeholder="e.g. Rotator cuff repair, 6 weeks post-op" />
            </Field>
            <Field label="Goals">
              <Textarea value={form.goals} onChange={v => setForm(f => ({ ...f, goals: v }))} rows={2} placeholder="e.g. Restore full shoulder range of motion" />
            </Field>
            <Btn variant="primary" onClick={handleSave} disabled={saving} fullWidth>
              {saving ? "Saving…" : "Register Patient"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab({ showToast }: { showToast: (msg: string, ok?: boolean) => void }) {
  const supabase = getSupabaseClient();
  const [templates, setTemplates] = useState<ExerciseTemplate[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Session builder form state
  const [sessionTitle, setSessionTitle] = useState("New Session");
  const [sessionObjective, setSessionObjective] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("none");
  const [estimatedMins, setEstimatedMins] = useState("10");
  const [exercises, setExercises] = useState<SessionExercise[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: tmpl }, { data: pts }, { data: sess }] = await Promise.all([
      supabase.from("exercise_templates").select("*").order("display_name"),
      supabase.from("patient_profiles").select("*, profiles(full_name)").order("created_at", { ascending: false }),
      supabase.from("session_prescriptions").select("*, prescription_exercises(*, exercise_templates(display_name, default_reps, default_hold_ms))").order("created_at", { ascending: false }),
    ]);

    if (tmpl) {
      setTemplates(tmpl);
      if (tmpl.length > 0) setSelectedTemplateId(tmpl[0].id);
    }

    if (pts) {
      setPatients(pts.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        full_name: (p.profiles as { full_name: string } | null)?.full_name ?? "Unknown",
        patient_type: p.patient_type as string,
        condition_notes: p.condition_notes as string | null,
        date_of_birth: p.date_of_birth as string | null,
        created_at: p.created_at as string,
      })));
    }

    if (sess) {
      setSessions(sess.map((s: Record<string, unknown>) => {
        const prescExercises = (s.prescription_exercises as Array<Record<string, unknown>>) ?? [];
        return {
          id: s.id as string,
          title: s.title as string,
          objective: s.objective as string | null,
          patient_id: s.patient_id as string | null,
          status: s.status as string,
          estimated_duration_mins: s.estimated_duration_mins as number,
          created_at: s.created_at as string,
          exercises: prescExercises
            .sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number))
            .map(e => ({
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
    setExercises(prev => [...prev, {
      template_id: tmpl.id,
      display_name: tmpl.display_name,
      reps: tmpl.default_reps,
      hold_ms: tmpl.default_hold_ms,
      sequence_order: prev.length,
    }]);
  };

  const removeExercise = (idx: number) => {
    setExercises(prev => prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, sequence_order: i })));
  };

  const moveExercise = (idx: number, dir: -1 | 1) => {
    const newEx = [...exercises];
    const swap = idx + dir;
    if (swap < 0 || swap >= newEx.length) return;
    [newEx[idx], newEx[swap]] = [newEx[swap], newEx[idx]];
    setExercises(newEx.map((e, i) => ({ ...e, sequence_order: i })));
  };

  const updateExercise = (idx: number, key: "reps" | "hold_ms", value: number) => {
    setExercises(prev => prev.map((e, i) => i === idx ? { ...e, [key]: value } : e));
  };

  const saveSession = async (testMode = false) => {
    if (!sessionTitle.trim()) { showToast("Session title is required.", false); return; }
    if (exercises.length === 0) { showToast("Add at least one exercise.", false); return; }
    setSaving(true);
    try {
      const { data: prescription, error: pErr } = await supabase
        .from("session_prescriptions")
        .insert({
          title: sessionTitle,
          objective: sessionObjective || null,
          patient_id: selectedPatientId === "none" ? null : selectedPatientId,
          physio_id: null,
          estimated_duration_mins: parseInt(estimatedMins) || 10,
          status: "pending",
        })
        .select()
        .single();
      if (pErr) throw pErr;

      const exerciseRows = exercises.map((e, i) => ({
        prescription_id: prescription.id,
        template_id: e.template_id,
        sequence_order: i,
        reps_override: e.reps,
        hold_ms_override: e.hold_ms,
      }));

      const { error: eErr } = await supabase.from("prescription_exercises").insert(exerciseRows);
      if (eErr) throw eErr;

      showToast("Session saved successfully.");

      if (testMode) {
        // Open session runner with this prescription
        window.open(`/session?prescription=${prescription.id}`, "_blank");
      }

      // Reset form
      setSessionTitle("New Session");
      setSessionObjective("");
      setSelectedPatientId("none");
      setExercises([]);
      loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to save session.", false);
    } finally {
      setSaving(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm("Delete this session?")) return;
    await supabase.from("prescription_exercises").delete().eq("prescription_id", id);
    await supabase.from("session_prescriptions").delete().eq("id", id);
    showToast("Session deleted.");
    loadData();
  };

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted, fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, alignItems: "start" }}>

      {/* Session Builder */}
      <div>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Session Builder</h2>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>Build a session from the exercise library and assign to a patient.</p>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionHeader title="Session Details" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Session Title">
              <Input value={sessionTitle} onChange={setSessionTitle} placeholder="e.g. Shoulder Recovery Week 1" />
            </Field>
            <Field label="Estimated Duration (mins)">
              <Input type="number" value={estimatedMins} onChange={setEstimatedMins} min={1} max={60} />
            </Field>
          </div>
          <Field label="Objective" hint="Clinical goal for this session">
            <Input value={sessionObjective} onChange={setSessionObjective} placeholder="e.g. Build shoulder strength and range of motion" />
          </Field>
          <Field label="Assign to Patient" hint="Optional — skip for test sessions">
            <Select value={selectedPatientId} onChange={setSelectedPatientId}>
              <option value="none">— Test Mode (no patient) —</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.full_name} · {PATIENT_TYPE_LABELS[p.patient_type] ?? p.patient_type}</option>
              ))}
            </Select>
          </Field>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <SectionHeader title="Add Exercises" />
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <Select value={selectedTemplateId} onChange={setSelectedTemplateId}>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.display_name} · {t.default_reps} reps · {msToSeconds(t.default_hold_ms)}s hold
                    </option>
                  ))}
                </Select>
              </div>
              <Btn onClick={addExercise} variant="primary">+ Add</Btn>
            </div>

            {exercises.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: C.textDim, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
                No exercises added yet. Pick one above and click + Add.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {exercises.map((ex, idx) => (
                  <div key={idx} style={{
                    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
                  }}>
                    {/* Order controls */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button onClick={() => moveExercise(idx, -1)} disabled={idx === 0}
                        style={{ background: "none", border: "none", color: idx === 0 ? C.textDim : C.textMuted, cursor: idx === 0 ? "default" : "pointer", fontSize: 12, padding: 2 }}>▲</button>
                      <span style={{ fontSize: 11, color: C.textDim, textAlign: "center" }}>{idx + 1}</span>
                      <button onClick={() => moveExercise(idx, 1)} disabled={idx === exercises.length - 1}
                        style={{ background: "none", border: "none", color: idx === exercises.length - 1 ? C.textDim : C.textMuted, cursor: idx === exercises.length - 1 ? "default" : "pointer", fontSize: 12, padding: 2 }}>▼</button>
                    </div>

                    {/* Exercise name */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>{ex.display_name}</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, color: C.textDim }}>Reps</span>
                          <input type="number" value={ex.reps} min={1} max={30}
                            onChange={e => updateExercise(idx, "reps", parseInt(e.target.value) || 1)}
                            style={{ width: 50, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                          />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, color: C.textDim }}>Hold (s)</span>
                          <input type="number" value={msToSeconds(ex.hold_ms)} min={0} max={10} step={0.5}
                            onChange={e => updateExercise(idx, "hold_ms", secondsToMs(e.target.value))}
                            style={{ width: 50, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                          />
                        </div>
                      </div>
                    </div>

                    <button onClick={() => removeExercise(idx)}
                      style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: 4, opacity: 0.7 }}>✕</button>
                  </div>
                ))}

                {/* Session summary */}
                <div style={{ background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: C.blue, marginTop: 4 }}>
                  {exercises.length} exercise{exercises.length !== 1 ? "s" : ""} · est. {estimatedMins} min
                  {selectedPatientId !== "none" && ` · ${patients.find(p => p.id === selectedPatientId)?.full_name ?? ""}`}
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: "flex", gap: 10 }}>
            <Btn onClick={() => saveSession(false)} variant="ghost" disabled={saving}>
              Save Session
            </Btn>
            <Btn onClick={() => saveSession(true)} variant="primary" disabled={saving}>
              {saving ? "Saving…" : "⚡ Save + Test Now"}
            </Btn>
            <Btn onClick={() => { setExercises([]); setSessionTitle("New Session"); setSessionObjective(""); setSelectedPatientId("none"); }} variant="danger" small>
              Clear
            </Btn>
          </div>
          <p style={{ fontSize: 11, color: C.textDim, margin: 0 }}>
            "Save + Test Now" opens the session runner immediately in a new tab.
          </p>
        </div>
      </div>

      {/* Saved Sessions */}
      <div>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Saved Sessions</h2>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>{sessions.length} sessions</p>
        </div>

        {sessions.length === 0 ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "32px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, color: C.textMuted }}>No sessions yet. Build one and save it.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sessions.map(s => (
              <div key={s.id} style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.title}</div>
                    {s.objective && <div style={{ fontSize: 12, color: C.textMuted }}>{s.objective}</div>}
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                      {s.exercises.length} exercise{s.exercises.length !== 1 ? "s" : ""} · {s.estimated_duration_mins} min
                      {s.patient_id ? " · Assigned" : " · Test session"}
                    </div>
                  </div>
                  <Badge label={s.status} color={s.status === "completed" ? C.green : s.status === "pending" ? C.blue : C.textMuted} />
                </div>

                {/* Exercise list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {s.exercises.map((ex, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
                      <span style={{ color: C.textDim, minWidth: 16 }}>{i + 1}.</span>
                      <span style={{ flex: 1, color: C.text }}>{ex.display_name}</span>
                      <span>{ex.reps}× · {msToSeconds(ex.hold_ms)}s</span>
                    </div>
                  ))}
                </div>

                {/* Run + Delete */}
                <div style={{ display: "flex", gap: 8, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                  <Btn onClick={() => window.open(`/session?prescription=${s.id}`, "_blank")} variant="primary" small>
                    ▶ Run Session
                  </Btn>
                  <Btn onClick={() => deleteSession(s.id)} variant="danger" small>Delete</Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Exercise Library Tab (wrapper) ──────────────────────────────────────────

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
    setVanillaTemplates(v ?? []);
    setMyTemplates(m ?? []);
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
      setEditingTemplate(null);
      loadTemplates();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Save failed.", false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: ExerciseTemplate) => {
    if (!confirm(`Delete "${template.display_name}"?`)) return;
    await supabase.from("exercise_templates").delete().eq("id", template.id);
    showToast("Exercise deleted.");
    loadTemplates();
  };

  const raw = subTab === "vanilla" ? vanillaTemplates : myTemplates;
  const active = raw.filter(t => {
    const matchSearch = search === "" || t.display_name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || t.exercise_type === typeFilter;
    return matchSearch && matchType;
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
          <button onClick={() => { setSearch(""); setTypeFilter("all"); }}
            style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.textMuted, fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
            Clear
          </button>
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
          <div style={{ fontSize: 13, color: C.textMuted }}>
            {subTab === "mine" && !search && !typeFilter ? "Clone a system template to get started." : ""}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16 }}>
          {active.map(t => (
            <ExerciseCard key={t.id} template={t}
              onEdit={() => setEditingTemplate({ ...t })}
              onClone={() => setEditingTemplate({ ...t, id: "", is_vanilla: false, display_name: `${t.display_name} (Custom)`, created_by: null })}
              onDelete={!t.is_vanilla ? () => handleDelete(t) : undefined}
            />
          ))}
        </div>
      )}

      {editingTemplate && (
        <ExerciseEditor template={editingTemplate} onSave={handleSave} onClose={() => setEditingTemplate(null)} saving={saving} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "library" | "patients" | "sessions";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "library",  label: "Exercise Library", icon: "🏋️" },
    { key: "patients", label: "Patients",          icon: "👤" },
    { key: "sessions", label: "Sessions",          icon: "📋" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Top nav */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 32px", display: "flex", alignItems: "center", height: 56, gap: 0, position: "sticky", top: 0, background: C.bg, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 32 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>AI Physio</span>
          <span style={{ color: C.border, fontSize: 16, margin: "0 4px" }}>|</span>
          <span style={{ fontSize: 14, color: C.textMuted }}>Admin</span>
        </div>

        {/* Tab nav */}
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(({ key, label, icon }) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
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
          <a href="/session" target="_blank" style={{ fontSize: 12, color: C.blue, textDecoration: "none", padding: "6px 12px", border: `1px solid ${C.blue}40`, borderRadius: 6 }}>
            ▶ Open Session Runner
          </a>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px" }}>
        {activeTab === "library"  && <ExerciseLibraryTab showToast={showToast} />}
        {activeTab === "patients" && <PatientsTab showToast={showToast} />}
        {activeTab === "sessions" && <SessionsTab showToast={showToast} />}
      </div>

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  );
}
