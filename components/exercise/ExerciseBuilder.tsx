"use client";

import React, { useMemo, useState } from "react";
import { DEFAULT_RAISE_BUILDER_VALUES } from "@/lib/prescriptions/builderDefaults";
import { buildPrescriptionFromForm } from "@/lib/prescriptions/buildPrescription";
import type { BuilderFormValues } from "@/lib/prescriptions/builderTypes";

function NumberInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "#121933",
          color: "white"
        }}
      />
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "#121933",
          color: "white"
        }}
      />
    </label>
  );
}

export default function ExerciseBuilder() {
  const [form, setForm] = useState<BuilderFormValues>(DEFAULT_RAISE_BUILDER_VALUES);

  const prescription = useMemo(() => buildPrescriptionFromForm(form), [form]);

  function patch<K extends keyof BuilderFormValues>(key: K, value: BuilderFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
      <section
        style={{
          background: "#1a2040",
          padding: 20,
          borderRadius: 12,
          display: "grid",
          gap: 14
        }}
      >
        <h2 style={{ margin: 0 }}>Exercise Builder</h2>

        <TextInput label="Exercise ID" value={form.id} onChange={(v) => patch("id", v)} />
        <TextInput label="Exercise Name" value={form.name} onChange={(v) => patch("name", v)} />
        <TextInput
          label="Description"
          value={form.description}
          onChange={(v) => patch("description", v)}
        />

        <label style={{ display: "grid", gap: 6 }}>
          <span>Template</span>
          <select
            value={form.template}
            onChange={(e) => patch("template", e.target.value as BuilderFormValues["template"])}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#121933",
              color: "white"
            }}
          >
            <option value="raise_hold_lower">raise_hold_lower</option>
            <option value="rise_hold_lower">rise_hold_lower</option>
            <option value="alternating_lift">alternating_lift</option>
            <option value="static_hold">static_hold</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Side</span>
          <select
            value={form.side}
            onChange={(e) => patch("side", e.target.value as BuilderFormValues["side"])}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#121933",
              color: "white"
            }}
          >
            <option value="right">right</option>
            <option value="left">left</option>
            <option value="both">both</option>
            <option value="center">center</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Target Metric</span>
          <select
            value={form.targetMetric}
            onChange={(e) =>
              patch("targetMetric", e.target.value as BuilderFormValues["targetMetric"])
            }
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#121933",
              color: "white"
            }}
          >
            <option value="rightArmElevationDeg">rightArmElevationDeg</option>
            <option value="leftArmElevationDeg">leftArmElevationDeg</option>
            <option value="bilateralArmElevationDeg">bilateralArmElevationDeg</option>
          </select>
        </label>

        <TextInput
          label="Target Label"
          value={form.targetLabel}
          onChange={(v) => patch("targetLabel", v)}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberInput
            label="Start Threshold"
            value={form.startThreshold}
            onChange={(v) => patch("startThreshold", v)}
          />
          <NumberInput
            label="Target Threshold"
            value={form.targetThreshold}
            onChange={(v) => patch("targetThreshold", v)}
          />
          <NumberInput
            label="Finish Threshold"
            value={form.finishThreshold}
            onChange={(v) => patch("finishThreshold", v)}
          />
          <NumberInput
            label="Tolerance"
            value={form.targetTolerance}
            onChange={(v) => patch("targetTolerance", v)}
          />
          <NumberInput
            label="Rep Target"
            value={form.repTarget}
            onChange={(v) => patch("repTarget", v)}
          />
          <NumberInput
            label="Hold Duration (ms)"
            value={form.holdDurationMs}
            onChange={(v) => patch("holdDurationMs", v)}
          />
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.holdRequired}
            onChange={(e) => patch("holdRequired", e.target.checked)}
          />
          <span>Hold required</span>
        </label>
      </section>

      <section
        style={{
          background: "#1a2040",
          padding: 20,
          borderRadius: 12
        }}
      >
        <h2 style={{ marginTop: 0 }}>Generated Prescription</h2>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#d9e6ff"
          }}
        >
          {JSON.stringify(prescription, null, 2)}
        </pre>
      </section>
    </div>
  );
}
