import type { ExercisePrescription } from "@/lib/types/exercise";

const STORAGE_KEY = "ai_physio_custom_prescriptions_v1";

export function loadCustomPrescriptions(): ExercisePrescription[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed as ExercisePrescription[];
  } catch {
    return [];
  }
}

export function saveCustomPrescriptions(
  prescriptions: ExercisePrescription[]
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prescriptions));
  } catch {
    // ignore storage errors for now
  }
}
