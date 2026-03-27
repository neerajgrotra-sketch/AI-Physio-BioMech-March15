"use client";

// app/admin/page.tsx
// Physio exercise library — browse vanilla templates, clone, configure, save
// Design: clean clinical dark UI with precise typography — refined medical aesthetic

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ExerciseTemplate, CoachingStrings } from "@/lib/supabase/types";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#0d1117",
  surface:  "#161b22",
  surfaceHover: "#1c2230",
  border:   "#21262d",
  borderFocus: "#388bfd",
  text:     "#e6edf3",
  textMuted:"#7d8590",
  textDim:  "#484f58",
  green:    "#3fb950",
  greenDim: "rgba(63,185,80,0.12)",
  blue:     "#388bfd",
  blueDim:  "rgba(56,139,253,0.12)",
  orange:   "#d29922",
  orangeDim:"rgba(210,153,34,0.12)",
  red:      "#f85149",
  redDim:   "rgba(248,81,73,0.12)",
  purple:   "#a371f7",
};

const EXERCISE_TYPE_LABELS: Record<string, string> = {
  arm_raise: "Arm Raise",
  bilateral_arm_raise: "Bilateral Arm Raise",
  sit_to_stand: "Sit to Stand",
  custom: "Custom",
};

const EXERCISE_TYPE_COLOR: Record<string, string> = {
  arm_raise: C.blue,
  bilateral_arm_raise: C.purple,
  sit_to_stand: C.green,
  custom: C.orange,
};

// ─── Utilities ──────────────────────────────────────────────────────────────────
function msToSeconds(ms: number) { return (ms / 1000).toFixed(1); }
function secondsToMs(s: string) { return Math.round(parseFloat(s) * 1000); }

// ─── Sub-components ────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color,
      background: color + "20",
      border: `1px solid ${color}40`,
    }}>
      {label}
    </span>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: C.textDim, margin: 0 }}>{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = "text", min, max, step }: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "8px 12px",
        color: C.text,
        fontSize: 14,
        fontFamily: "inherit",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        transition: "border-color 0.15s",
      }}
      onFocus={e => (e.target.style.borderColor = C.borderFocus)}
      onBlur={e => (e.target.style.borderColor = C.border)}
    />
  );
}

function Textarea({ value, onChange, rows = 3 }: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={e => onChange(e.target.value)}
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "8px 12px",
        color: C.text,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        resize: "vertical",
        lineHeight: 1.6,
      }}
      onFocus={e => (e.target.style.borderColor = C.borderFocus)}
      onBlur={e => (e.target.style.borderColor = C.border)}
    />
  );
}

function Btn({
  children, onClick, variant = "ghost", disabled, small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  small?: boolean;
}) {
  const bgMap = { primary: C.blue, ghost: "transparent", danger: "transparent" };
  const colorMap = { primary: "#fff", ghost: C.text, danger: C.red };
  const borderMap = { primary: C.blue, ghost: C.border, danger: C.red + "60" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bgMap[variant],
        color: colorMap[variant],
        border: `1px solid ${borderMap[variant]}`,
        borderRadius: 6,
        padding: small ? "4px 10px" : "8px 16px",
        fontSize: small ? 12 : 13,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

// ─── Exercise Card ──────────────────────────────────────────────────────────────

function ExerciseCard({
  template,
  onEdit,
  onClone,
  onDelete,
}: {
  template: ExerciseTemplate;
  onEdit: () => void;
  onClone: () => void;
  onDelete?: () => void;
}) {
  const typeColor = EXERCISE_TYPE_COLOR[template.exercise_type] ?? C.textMuted;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      transition: "border-color 0.15s",
      cursor: "pointer",
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderFocus + "60")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
              {template.display_name}
            </span>
            <Badge
              label={EXERCISE_TYPE_LABELS[template.exercise_type] ?? template.exercise_type}
              color={typeColor}
            />
            {template.is_vanilla && (
              <Badge label="System" color={C.textMuted} />
            )}
            {template.bilateral && (
              <Badge label="Bilateral" color={C.purple} />
            )}
          </div>
          <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
            {template.description ?? "No description."}
          </p>
        </div>
      </div>

      {/* Params row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          { label: "Reps", value: template.default_reps },
          { label: "Hold", value: `${msToSeconds(template.default_hold_ms)}s` },
          { label: "Target", value: `${template.target_metric_degrees}°` },
          { label: "Rest", value: `${msToSeconds(template.default_rest_ms)}s` },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 50 }}>
            <span style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Clinical objective */}
      {template.clinical_objective && (
        <div style={{
          background: C.greenDim,
          border: `1px solid ${C.green}30`,
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          color: C.green,
          lineHeight: 1.5,
        }}>
          🎯 {template.clinical_objective}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
        {!template.is_vanilla && (
          <Btn onClick={onEdit} small>Edit</Btn>
        )}
        <Btn onClick={onEdit} small>
          {template.is_vanilla ? "View / Edit" : "Edit"}
        </Btn>
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

// ─── Exercise Editor Drawer ─────────────────────────────────────────────────────

function ExerciseEditor({
  template,
  onSave,
  onClose,
  saving,
}: {
  template: ExerciseTemplate;
  onSave: (t: ExerciseTemplate) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<ExerciseTemplate>({ ...template });

  function setField<K extends keyof ExerciseTemplate>(key: K, value: ExerciseTemplate[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function setCoaching(key: keyof CoachingStrings, value: string | string[]) {
    setForm(f => ({
      ...f,
      coaching_strings: { ...f.coaching_strings, [key]: value },
    }));
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      zIndex: 100,
      display: "flex",
      justifyContent: "flex-end",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(680px, 100vw)",
        height: "100vh",
        background: C.surface,
        borderLeft: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
              {template.is_vanilla ? "Clone Exercise" : "Edit Exercise"}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              {template.is_vanilla
                ? "Configuring a copy — original template is unchanged."
                : `Editing: ${template.display_name}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.textMuted, fontSize: 20, cursor: "pointer", padding: 4 }}
          >✕</button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Identity */}
            <section>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 14px" }}>
                Identity
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Display Name">
                  <Input value={form.display_name} onChange={v => setField("display_name", v)} />
                </Field>
                <Field label="Description">
                  <Textarea value={form.description ?? ""} onChange={v => setField("description", v)} />
                </Field>
                <Field label="Clinical Objective">
                  <Textarea value={form.clinical_objective ?? ""} onChange={v => setField("clinical_objective", v)} rows={2} />
                </Field>
              </div>
            </section>

            {/* Parameters */}
            <section>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 14px" }}>
                Movement Parameters
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Repetitions" hint="Number of reps per session">
                  <Input type="number" value={form.default_reps} min={1} max={30}
                    onChange={v => setField("default_reps", parseInt(v) || 1)} />
                </Field>
                <Field label="Hold Duration (seconds)" hint="How long to hold at top">
                  <Input type="number" value={msToSeconds(form.default_hold_ms)} min={0} max={10} step={0.5}
                    onChange={v => setField("default_hold_ms", secondsToMs(v))} />
                </Field>
                <Field label="Rest Between Reps (seconds)">
                  <Input type="number" value={msToSeconds(form.default_rest_ms)} min={0} max={10} step={0.5}
                    onChange={v => setField("default_rest_ms", secondsToMs(v))} />
                </Field>
                <Field label="Target Angle (degrees)" hint="Minimum angle for a successful rep">
                  <Input type="number" value={form.target_metric_degrees} min={10} max={180}
                    onChange={v => setField("target_metric_degrees", parseFloat(v) || 70)} />
                </Field>
              </div>
            </section>

            {/* Coaching Strings */}
            <section>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px" }}>
                Coaching Voice
              </h3>
              <p style={{ fontSize: 12, color: C.textDim, margin: "0 0 14px", lineHeight: 1.5 }}>
                Text that will be spoken to the patient. For "Hold" and "Success" — one variant per line, rotated automatically.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Exercise Intro" hint="Spoken when exercise begins">
                  <Textarea value={form.coaching_strings.intro} rows={2}
                    onChange={v => setCoaching("intro", v)} />
                </Field>
                <Field label="Hold Cues (one per line)" hint="Rotated on each rep">
                  <Textarea
                    value={Array.isArray(form.coaching_strings.hold)
                      ? form.coaching_strings.hold.join("\n")
                      : form.coaching_strings.hold}
                    rows={5}
                    onChange={v => setCoaching("hold", v.split("\n").filter(Boolean))}
                  />
                </Field>
                <Field label="Lower Cue">
                  <Input value={form.coaching_strings.lower}
                    onChange={v => setCoaching("lower", v)} />
                </Field>
                <Field label="First Rep Success">
                  <Input value={form.coaching_strings.success_first}
                    onChange={v => setCoaching("success_first", v)} />
                </Field>
                <Field label="Success Cues (one per line)" hint="Rotated on each successful rep">
                  <Textarea
                    value={Array.isArray(form.coaching_strings.success_rotating)
                      ? form.coaching_strings.success_rotating.join("\n")
                      : ""}
                    rows={6}
                    onChange={v => setCoaching("success_rotating", v.split("\n").filter(Boolean))}
                  />
                </Field>

                <h4 style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", margin: "4px 0 10px" }}>
                  Correction Cues
                </h4>
                {[
                  ["correction_height", "Height Correction", "When patient doesn't reach target angle"],
                  ["correction_hold", "Hold Correction", "When patient releases too early"],
                  ["correction_balance", "Balance Correction", "When trunk moves or sways"],
                  ["correction_isolation", "Isolation Correction", "When compensating muscles activate"],
                  ["exercise_complete", "Exercise Complete", "Spoken when all reps are done"],
                ].map(([key, label, hint]) => (
                  <Field key={key} label={label} hint={hint}>
                    <Input
                      value={(form.coaching_strings as unknown as Record<string, string>)[key] ?? ""}
                      onChange={v => setCoaching(key as keyof CoachingStrings, v)}
                    />
                  </Field>
                ))}
              </div>
            </section>

          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 24px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
        }}>
          <Btn onClick={onClose} variant="ghost">Cancel</Btn>
          <Btn onClick={() => onSave(form)} variant="primary" disabled={saving}>
            {saving ? "Saving…" : template.is_vanilla ? "Save as New Template" : "Save Changes"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const supabase = getSupabaseClient();

  const [vanillaTemplates, setVanillaTemplates] = useState<ExerciseTemplate[]>([]);
  const [myTemplates, setMyTemplates] = useState<ExerciseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ExerciseTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"vanilla" | "mine">("vanilla");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: vanilla, error: e1 } = await supabase
        .from("exercise_templates")
        .select("*")
        .eq("is_vanilla", true)
        .order("display_name");

      const { data: mine, error: e2 } = await supabase
        .from("exercise_templates")
        .select("*")
        .eq("is_vanilla", false)
        .order("display_name");

      if (e1) throw e1;
      if (e2) throw e2;

      setVanillaTemplates(vanilla ?? []);
      setMyTemplates(mine ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load templates. Check your Supabase connection.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleClone = (template: ExerciseTemplate) => {
    setEditingTemplate({
      ...template,
      id: "",
      is_vanilla: false,
      display_name: `${template.display_name} (Custom)`,
      created_by: null,
    });
  };

  const handleEdit = (template: ExerciseTemplate) => {
    setEditingTemplate({ ...template });
  };

  const handleSave = async (template: ExerciseTemplate) => {
    setSaving(true);
    try {
      // Always save custom templates as non-vanilla (never overwrite system templates)
      const isNew = !template.id || template.is_vanilla;
      const payload = {
        ...template,
        is_vanilla: false,
        created_by: null, // will be set properly once auth is added
      };

      if (isNew) {
        // New — clone from vanilla or create fresh
        const { id: _id, ...insertPayload } = payload;
        const { error } = await supabase
          .from("exercise_templates")
          .insert(insertPayload);
        if (error) {
          // RLS is blocking — remind user to disable RLS for testing
          if (error.code === "42501") {
          throw new Error("Permission denied. Disable RLS in Supabase to enable saving without auth.");
          }
          throw error;
        }
        showToast("Exercise created in My Library.");
      } else {
        // Update existing custom template
        const { error } = await supabase
          .from("exercise_templates")
          .update(payload)
          .eq("id", template.id);
        if (error) throw error;
        showToast("Exercise updated.");
      }

      setEditingTemplate(null);
      await loadTemplates();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Save failed.", false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: ExerciseTemplate) => {
    if (!confirm(`Delete "${template.display_name}"? This cannot be undone.`)) return;
    const { error } = await supabase
      .from("exercise_templates")
      .delete()
      .eq("id", template.id);
    if (error) {
      showToast(error.message, false);
    } else {
      showToast("Exercise deleted.");
      await loadTemplates();
    }
  };

  const rawTemplates = tab === "vanilla" ? vanillaTemplates : myTemplates;
  const activeTemplates = rawTemplates.filter(t => {
    const matchesSearch = search === "" ||
      t.display_name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || t.exercise_type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      color: C.text,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Top nav */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "0 32px",
        display: "flex",
        alignItems: "center",
        height: 56,
        gap: 24,
        position: "sticky",
        top: 0,
        background: C.bg,
        zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}>⚡</div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>
            AI Physio
          </span>
          <span style={{ color: C.border, fontSize: 16, margin: "0 4px" }}>|</span>
          <span style={{ fontSize: 14, color: C.textMuted }}>Exercise Library</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: C.textDim }}>
            {vanillaTemplates.length + myTemplates.length} templates
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px" }}>

        {/* Page header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            Exercise Library
          </h1>
          <p style={{ color: C.textMuted, fontSize: 14, margin: 0, lineHeight: 1.6 }}>
            Browse system templates and configure exercises for your patients.
            Clone any template to adjust parameters and coaching cues.
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex",
          gap: 2,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 4,
          width: "fit-content",
          marginBottom: 24,
        }}>
          {[
            { key: "vanilla", label: `System Templates (${vanillaTemplates.length})` },
            { key: "mine", label: `My Library (${myTemplates.length})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key as "vanilla" | "mine")}
              style={{
                background: tab === key ? C.surfaceHover : "transparent",
                border: `1px solid ${tab === key ? C.border : "transparent"}`,
                borderRadius: 6,
                padding: "6px 16px",
                color: tab === key ? C.text : C.textMuted,
                fontSize: 13,
                fontWeight: tab === key ? 600 : 400,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search + Filter */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search exercises…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 200,
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "8px 12px",
              color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none",
            }}
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "8px 12px",
              color: typeFilter === "all" ? C.textMuted : C.text,
              fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer",
            }}
          >
            <option value="all">All types</option>
            <option value="arm_raise">Arm Raise</option>
            <option value="bilateral_arm_raise">Bilateral Arm Raise</option>
            <option value="sit_to_stand">Sit to Stand</option>
            <option value="custom">Custom</option>
          </select>
          {(search || typeFilter !== "all") && (
            <button
              onClick={() => { setSearch(""); setTypeFilter("all"); }}
              style={{
                background: "transparent", border: `1px solid ${C.border}`,
                borderRadius: 6, padding: "8px 12px",
                color: C.textMuted, fontSize: 12, fontFamily: "inherit", cursor: "pointer",
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>
            <div style={{ fontSize: 14 }}>Loading templates…</div>
          </div>
        ) : error ? (
          <div style={{
            background: C.redDim,
            border: `1px solid ${C.red}40`,
            borderRadius: 8,
            padding: "16px 20px",
            color: C.red,
            fontSize: 14,
          }}>
            <strong>Connection Error</strong>
            <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>{error}</p>
            <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.7 }}>
              Make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local
            </p>
          </div>
        ) : activeTemplates.length === 0 ? (
          <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "48px 32px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              {tab === "vanilla" ? "📋" : "🗂️"}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>
              {tab === "vanilla" ? "No system templates found" : "No custom exercises yet"}
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
              {tab === "vanilla"
                ? "Run the seed SQL in Supabase to add the four vanilla exercise templates."
                : "Clone a system template and customise it for your patients."}
            </div>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))",
            gap: 16,
          }}>
            {activeTemplates.map(t => (
              <ExerciseCard
                key={t.id}
                template={t}
                onClone={() => handleClone(t)}
                onEdit={() => handleEdit(t)}
                onDelete={!t.is_vanilla ? () => handleDelete(t) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor drawer */}
      {editingTemplate && (
        <ExerciseEditor
          template={editingTemplate}
          onSave={handleSave}
          onClose={() => setEditingTemplate(null)}
          saving={saving}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: toast.ok ? C.greenDim : C.redDim,
          border: `1px solid ${toast.ok ? C.green : C.red}40`,
          color: toast.ok ? C.green : C.red,
          borderRadius: 8,
          padding: "12px 18px",
          fontSize: 13,
          fontWeight: 500,
          zIndex: 200,
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          animation: "fadeIn 0.2s ease",
        }}>
          {toast.ok ? "✓" : "✕"} {toast.msg}
        </div>
      )}
    </div>
  );
}
