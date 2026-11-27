// ============================================================
// lib/coach/patientTolerances.ts
// ============================================================
// The clinical tolerances a physio sets for one patient's exercise when
// assigning a protocol (the owner: these are per-patient decisions, not
// clinic-wide). Saved on session_block_exercises.tolerances; only what the
// physio chose is stored. A session uses, in order: this patient's exercise
// setting, else the clinic default (Coach Lab), else the built-in default.
// Presets so the physio needn't move sliders: Standard (the clinic's
// defaults), Gentle (limited mobility), Strict. Pure. Tested by
// patientTolerances.test.ts.
// ============================================================

import { COACH_SETTING_DEFS, type CoachSettings } from "@/lib/coach/coachSettings";

export type ToleranceKey = "sidewaysAllowanceDeg" | "holdSlipSeconds" | "otherArmAllowanceDeg";
export type PatientTolerances = Partial<Record<ToleranceKey, number>>;
export const TOLERANCE_KEYS: ToleranceKey[] = ["sidewaysAllowanceDeg", "holdSlipSeconds", "otherArmAllowanceDeg"];

export type PresetName = "standard" | "gentle" | "strict";
export const PRESETS: Record<PresetName, { label: string; help: string; values: PatientTolerances }> = {
  standard: { label: "Standard", help: "The clinic's defaults (Coach Lab).", values: {} },
  gentle: { label: "Gentle", help: "For limited mobility: more drift allowed, longer slips forgiven.",
    values: { sidewaysAllowanceDeg: 85, holdSlipSeconds: 2, otherArmAllowanceDeg: 50 } },
  strict: { label: "Strict", help: "For precise form: a straight-forward raise, short slips only.",
    values: { sidewaysAllowanceDeg: 60, holdSlipSeconds: 0.5, otherArmAllowanceDeg: 25 } },
};

const defOf = (k: ToleranceKey) => COACH_SETTING_DEFS.find((d) => d.key === k)!;
const clamp = (k: ToleranceKey, v: number) => { const d = defOf(k); return Math.min(d.max!, Math.max(d.min!, v)); };

/** Only valid, in-range values from what was saved (bad ones dropped). */
export function cleanTolerances(saved: unknown): PatientTolerances {
  const src = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const out: PatientTolerances = {};
  for (const k of TOLERANCE_KEYS) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp(k, v);
  }
  return out;
}

/** The values a session uses: this patient's, else the clinic's. */
export function effectiveTolerances(patient: unknown, clinic: CoachSettings): Record<ToleranceKey, number> {
  const p = cleanTolerances(patient);
  return {
    sidewaysAllowanceDeg: p.sidewaysAllowanceDeg ?? clinic.sidewaysAllowanceDeg,
    holdSlipSeconds: p.holdSlipSeconds ?? clinic.holdSlipSeconds,
    otherArmAllowanceDeg: p.otherArmAllowanceDeg ?? clinic.otherArmAllowanceDeg,
  };
}

/** Which preset the saved values match, or "custom". */
export function presetOf(patient: unknown): PresetName | "custom" {
  const p = cleanTolerances(patient);
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const v = PRESETS[name].values;
    if (TOLERANCE_KEYS.every((k) => p[k] === v[k])) return name;
  }
  return "custom";
}

/** Labels, ranges and help for the assign screen (shared with the Coach Lab). */
export const TOLERANCE_DEFS = TOLERANCE_KEYS.map(defOf);
