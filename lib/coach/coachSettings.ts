// ============================================================
// lib/coach/coachSettings.ts
// ============================================================
// The coach's adjustable behaviour (the owner's request: controls in admin
// to see how the coach behaves). Each setting has a default (today's tuned
// value), a range and a plain explanation; the Coach Lab in /admin edits them,
// they are saved per clinic in public.coach_settings, and the session page
// reads them so test runs use them. `resolveCoachSettings` fills gaps with
// defaults and keeps every value inside its range, so a bad or old saved
// value can never break a session. Pure. Tested by coachSettings.test.ts.
// ============================================================

export type CoachSettings = {
  // The guide figure
  guideOrbitOn: boolean;
  guideOrbitSeconds: number;
  guideOrbitNearDeg: number;
  guideOrbitFarDeg: number;
  postureSwitchSeconds: number;
  // Voice
  voiceRate: number;
  demoNarrationOn: boolean;
  // Watching the other arm
  wrongArmRiseDeg: number;
  wrongArmSeconds: number;
  otherArmAllowanceDeg: number;
  restSettleSeconds: number;
  // Coaching cues
  stallSeconds: number;
  // Walking away
  awayPauseSeconds: number;
  awayCountdownSeconds: number;
  awayEndSeconds: number;
};

export type SettingDef = {
  key: keyof CoachSettings;
  group: "Guide figure" | "Voice" | "Other arm" | "Coaching cues" | "Walking away";
  label: string;
  help: string;
  kind: "number" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
};

export const COACH_DEFAULTS: CoachSettings = {
  guideOrbitOn: true,
  guideOrbitSeconds: 14,
  guideOrbitNearDeg: 18,
  guideOrbitFarDeg: 62,
  postureSwitchSeconds: 6,
  voiceRate: 0.95,
  demoNarrationOn: true,
  wrongArmRiseDeg: 30,
  wrongArmSeconds: 0.4,
  otherArmAllowanceDeg: 35,
  restSettleSeconds: 3,
  stallSeconds: 1.5,
  awayPauseSeconds: 10,
  awayCountdownSeconds: 60,
  awayEndSeconds: 90,
};

export const COACH_SETTING_DEFS: SettingDef[] = [
  { key: "guideOrbitOn", group: "Guide figure", kind: "boolean", label: "Walk round the patient",
    help: "The guide slowly turns between a three-quarter view and nearly facing the patient during the exercise." },
  { key: "guideOrbitSeconds", group: "Guide figure", kind: "number", min: 6, max: 40, step: 1, unit: "s", label: "Time for one turn",
    help: "How long one full turn out and back takes. Lower is faster." },
  { key: "guideOrbitNearDeg", group: "Guide figure", kind: "number", min: 0, max: 50, step: 1, unit: "°", label: "Closest to facing",
    help: "0 faces the patient head on; higher stays more side on." },
  { key: "guideOrbitFarDeg", group: "Guide figure", kind: "number", min: 30, max: 90, step: 1, unit: "°", label: "Furthest to the side",
    help: "90 is fully side on (best for seeing how high the arm goes)." },
  { key: "postureSwitchSeconds", group: "Guide figure", kind: "number", min: 1, max: 20, step: 0.5, unit: "s", label: "Sit/stand change after",
    help: "How long the patient must be seen in the other posture (between reps) before the guide sits down or stands up." },
  { key: "voiceRate", group: "Voice", kind: "number", min: 0.7, max: 1.2, step: 0.05, unit: "×", label: "Speaking speed",
    help: "1 is normal speed; lower is slower and clearer for older patients." },
  { key: "demoNarrationOn", group: "Voice", kind: "boolean", label: "Talk through the demonstration",
    help: "\"Watch me first… up to here… and slowly down… your turn.\"" },
  { key: "wrongArmRiseDeg", group: "Other arm", kind: "number", min: 15, max: 60, step: 1, unit: "°", label: "Wrong-arm call when lifted by",
    help: "How far above its resting place the other arm must rise (with the exercise arm down) before \"That's your left arm\". Lower is more sensitive." },
  { key: "wrongArmSeconds", group: "Other arm", kind: "number", min: 0.1, max: 2, step: 0.1, unit: "s", label: "Wrong-arm call after",
    help: "How long the wrong arm must stay up before the call." },
  { key: "otherArmAllowanceDeg", group: "Other arm", kind: "number", min: 15, max: 70, step: 1, unit: "°", label: "Other arm may move by",
    help: "During a rep, the other arm may rise this far above its resting place; more fails the rep as \"keep the other arm still\"." },
  { key: "restSettleSeconds", group: "Other arm", kind: "number", min: 1, max: 10, step: 0.5, unit: "s", label: "Resting place settles over",
    help: "How quickly the app re-learns where the other arm rests between reps. Slower ignores camera glitches better." },
  { key: "stallSeconds", group: "Coaching cues", kind: "number", min: 0.5, max: 5, step: 0.5, unit: "s", label: "\"A little higher\" after",
    help: "How long the arm must stop short of the target before the coach asks for a little more." },
  { key: "awayPauseSeconds", group: "Walking away", kind: "number", min: 3, max: 60, step: 1, unit: "s", label: "Pause when not seen for",
    help: "Nobody in view this long: the coach pauses and says \"I can't see you\"." },
  { key: "awayCountdownSeconds", group: "Walking away", kind: "number", min: 10, max: 300, step: 5, unit: "s", label: "Start the countdown at",
    help: "When the \"Saving and closing in…\" countdown appears." },
  { key: "awayEndSeconds", group: "Walking away", kind: "number", min: 20, max: 600, step: 5, unit: "s", label: "Save and close at",
    help: "When the session is saved as paused and closed." },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Saved (possibly partial, old or bad) values -> a complete, safe set. */
export function resolveCoachSettings(saved: unknown): CoachSettings {
  const src = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const out: CoachSettings = { ...COACH_DEFAULTS };
  for (const d of COACH_SETTING_DEFS) {
    const v = src[d.key];
    if (d.kind === "boolean") {
      if (typeof v === "boolean") (out as any)[d.key] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      (out as any)[d.key] = clamp(v, d.min ?? -Infinity, d.max ?? Infinity);
    }
  }
  // Keep the pairs in order.
  if (out.guideOrbitNearDeg > out.guideOrbitFarDeg) out.guideOrbitNearDeg = out.guideOrbitFarDeg;
  out.awayCountdownSeconds = Math.max(out.awayCountdownSeconds, out.awayPauseSeconds + 1);
  out.awayEndSeconds = Math.max(out.awayEndSeconds, out.awayCountdownSeconds + 5);
  return out;
}

/** Only the values that differ from the defaults (what gets saved). */
export function changedFromDefaults(s: CoachSettings): Partial<CoachSettings> {
  const out: Partial<CoachSettings> = {};
  for (const k of Object.keys(COACH_DEFAULTS) as (keyof CoachSettings)[]) {
    if (s[k] !== COACH_DEFAULTS[k]) (out as any)[k] = s[k];
  }
  return out;
}

/** The guide's viewing angle on its slow walk round the patient, at time t (s). */
export function orbitYaw(s: CoachSettings, tSeconds: number): number {
  const mid = (s.guideOrbitNearDeg + s.guideOrbitFarDeg) / 2;
  const half = (s.guideOrbitFarDeg - s.guideOrbitNearDeg) / 2;
  if (!s.guideOrbitOn) return s.guideOrbitFarDeg;
  return mid + half * Math.sin(tSeconds * (2 * Math.PI / s.guideOrbitSeconds));
}
