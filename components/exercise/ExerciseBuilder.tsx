"use client";

import React, { useMemo, useState } from "react";
import { DEFAULT_RAISE_BUILDER_VALUES } from "@/lib/prescriptions/builderDefaults";
import { buildPrescriptionFromForm } from "@/lib/prescriptions/buildPrescription";
import type { BuilderFormValues } from "@/lib/prescriptions/builderTypes";
import { usePrescriptionLibrary } from "@/components/providers/PrescriptionLibraryProvider";

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
  const { savePrescription, customPrescriptions, deletePrescription } =
    usePrescriptionLibrary();

  const [form, setForm] = useState<BuilderFormValues>(DEFAULT_RAISE_BUILDER_VALUES);
  const [saveMessage, setSaveMessage] = useState("");

  const prescription = useMemo(() => buildPrescriptionFromForm(form), [form]);

  function patch<K extends keyof BuilderFormValues>(
    key: K,
    value: BuilderFormValues[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    savePrescription(prescription);
    setSaveMessage(`Saved "${prescription.name}" to your custom library.`);
    window.setTimeout(() => setSaveMessage(""), 2500);
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

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={handleSave}
            style={{
              background: "#7cc6ff",
              color: "#08111f",
              fontWeight: 700,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer"
            }}
          >
            Save Prescription
          </button>
        </div>

        {saveMessage && (
          <p style={{ margin: 0, color: "#9be7b0" }}>{saveMessage}</p>
        )}
      </section>

      <section
        style={{
          background: "#1a2040",
          padding: 20,
          borderRadius: 12,
          display: "grid",
          gap: 18
        }}
      >
        <div>
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
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>Custom Library</h2>

          {customPrescriptions.length === 0 ? (
            <p style={{ color: "#aab6d3" }}>No custom prescriptions saved yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {customPrescriptions.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: 12,
                    background: "rgba(255,255,255,0.03)"
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{item.name}</div>
                  <div style={{ fontSize: 13, color: "#aab6d3", marginTop: 4 }}>
                    {item.id}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => deletePrescription(item.id)}
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        color: "white",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer"
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
