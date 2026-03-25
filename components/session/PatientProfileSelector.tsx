// ============================================================
// components/session/PatientProfileSelector.tsx
// ============================================================
// UI component for selecting patient profile at session start.
//
// Shown in the session selector panel before Begin Session.
// Lets the user (or clinician) set:
// - Patient type (senior, post-surgery, chronic pain, fitness)
// - Session number (drives familiarity and instruction detail)
// - Optional clinical notes
//
// These selections flow into every AI call in the session.
// ============================================================

"use client";

import React from "react";
import type { PatientProfile, PatientType } from "@/lib/patient/patientTypes";

type PatientProfileSelectorProps = {
  profile: PatientProfile;
  onChange: (updates: Partial<PatientProfile>) => void;
  disabled?: boolean;
};

type PatientTypeOption = {
  value: PatientType;
  label: string;
  description: string;
  color: string;
};

const PATIENT_TYPE_OPTIONS: PatientTypeOption[] = [
  {
    value: "senior",
    label: "Senior / Elderly",
    description: "Calm, simple, reassuring guidance",
    color: "#9be7b0"
  },
  {
    value: "post_surgery",
    label: "Post-Surgery Rehab",
    description: "Precise, safety-conscious coaching",
    color: "#7cc6ff"
  },
  {
    value: "chronic_pain",
    label: "Chronic Pain / Mobility",
    description: "Gentle, patient, acknowledges difficulty",
    color: "#d4a8ff"
  },
  {
    value: "general_fitness",
    label: "General Fitness",
    description: "Clear, direct, efficient coaching",
    color: "#ffcc80"
  }
];

export default function PatientProfileSelector({
  profile,
  onChange,
  disabled = false
}: PatientProfileSelectorProps) {
  return (
    <div
      style={{
        background: "#121933",
        borderRadius: 12,
        padding: 16,
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "#7cc6ff",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 12
        }}
      >
        Patient Profile
      </div>

      {/* Patient Type Selection */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            color: "#aab6d3",
            marginBottom: 8
          }}
        >
          Patient type — shapes AI coaching language and tone
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8
          }}
        >
          {PATIENT_TYPE_OPTIONS.map((option) => {
            const selected = profile.type === option.value;

            return (
              <button
                key={option.value}
                onClick={() =>
                  !disabled && onChange({ type: option.value })
                }
                disabled={disabled}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: selected
                    ? `1px solid ${option.color}66`
                    : "1px solid rgba(255,255,255,0.08)",
                  background: selected
                    ? `${option.color}18`
                    : "rgba(255,255,255,0.04)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  opacity: disabled ? 0.6 : 1,
                  transition: "all 0.15s ease"
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: selected ? option.color : "white",
                    marginBottom: 3
                  }}
                >
                  {option.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#7a88a8",
                    lineHeight: 1.4
                  }}
                >
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Session Number */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            color: "#aab6d3",
            marginBottom: 8
          }}
        >
          Session number — affects instruction detail level
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((num) => {
            const selected = profile.sessionNumber === num;
            const label =
              num === 1
                ? "1st"
                : num === 2
                ? "2nd"
                : num === 3
                ? "3rd"
                : `${num}th`;
            const sublabel =
              num === 1
                ? "Full instructions"
                : num <= 3
                ? "Brief cues"
                : "Minimal cues";

            return (
              <button
                key={num}
                onClick={() =>
                  !disabled && onChange({ sessionNumber: num })
                }
                disabled={disabled}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: selected
                    ? "1px solid rgba(124,198,255,0.4)"
                    : "1px solid rgba(255,255,255,0.08)",
                  background: selected
                    ? "rgba(124,198,255,0.12)"
                    : "rgba(255,255,255,0.04)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "center",
                  opacity: disabled ? 0.6 : 1
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: selected ? "#7cc6ff" : "white"
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 10, color: "#7a88a8", marginTop: 2 }}>
                  {sublabel}
                </div>
              </button>
            );
          })}

          {/* 6+ option */}
          <button
            onClick={() =>
              !disabled && onChange({ sessionNumber: 6 })
            }
            disabled={disabled}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border:
                profile.sessionNumber >= 6
                  ? "1px solid rgba(124,198,255,0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
              background:
                profile.sessionNumber >= 6
                  ? "rgba(124,198,255,0.12)"
                  : "rgba(255,255,255,0.04)",
              cursor: disabled ? "not-allowed" : "pointer",
              textAlign: "center",
              opacity: disabled ? 0.6 : 1
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 13,
                color: profile.sessionNumber >= 6 ? "#7cc6ff" : "white"
              }}
            >
              6+
            </div>
            <div style={{ fontSize: 10, color: "#7a88a8", marginTop: 2 }}>
              Expert
            </div>
          </button>
        </div>
      </div>

      {/* Returning Patient Toggle */}
      <div style={{ marginBottom: 14 }}>
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1
          }}
        >
          <input
            type="checkbox"
            checked={profile.isReturningPatient}
            onChange={(e) =>
              !disabled &&
              onChange({ isReturningPatient: e.target.checked })
            }
            disabled={disabled}
          />
          <div>
            <div style={{ fontSize: 13, color: "white", fontWeight: 600 }}>
              Returning patient
            </div>
            <div style={{ fontSize: 11, color: "#7a88a8", marginTop: 2 }}>
              AI will skip introductory explanations
            </div>
          </div>
        </label>
      </div>

      {/* Clinical Notes */}
      <div>
        <div
          style={{
            fontSize: 13,
            color: "#aab6d3",
            marginBottom: 6
          }}
        >
          Clinical notes{" "}
          <span style={{ color: "#7a88a8", fontSize: 11 }}>
            (optional — visible to AI coaching only)
          </span>
        </div>

        <textarea
          value={profile.clinicalNotes ?? ""}
          onChange={(e) =>
            !disabled &&
            onChange({
              clinicalNotes: e.target.value || null
            })
          }
          disabled={disabled}
          placeholder="e.g. Right shoulder replacement. Limited range expected on right arm raise."
          rows={2}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 10px",
            color: "white",
            fontSize: 13,
            resize: "vertical",
            fontFamily: "inherit",
            lineHeight: 1.5,
            opacity: disabled ? 0.6 : 1,
            boxSizing: "border-box"
          }}
        />
      </div>

      {/* Active profile summary */}
      <div
        style={{
          marginTop: 12,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(124,198,255,0.06)",
          border: "1px solid rgba(124,198,255,0.15)",
          fontSize: 12,
          color: "#7cc6ff",
          lineHeight: 1.5
        }}
      >
        AI will use:{" "}
        <strong>
          {
            PATIENT_TYPE_OPTIONS.find((o) => o.value === profile.type)
              ?.label
          }
        </strong>{" "}
        tone ·{" "}
        <strong>
          Session {profile.sessionNumber}
        </strong>{" "}
        instruction level
        {profile.clinicalNotes && (
          <> · Clinical notes provided</>
        )}
      </div>
    </div>
  );
}
