// ============================================================
// lib/positioning/positioningSteps.ts
// ============================================================
// The positioning checklist the coach panel shows (SessionRunner, left
// panel, while the patient is being placed): which steps are done, which
// one is being worked on now, and which are still to come. The position
// coach (positionCoach.ts) reports only the FIRST thing to fix, in a fixed
// order, so everything before it is already right.
// Pure. Tested by positioningSteps.test.ts.
// ============================================================

export type StepStatus = "done" | "now" | "todo";
export type PositioningStep = { key: string; label: string; status: StepStatus };

// The coach's checks, in the order it makes them, and the issue ids of each.
const STEPS: Array<{ key: string; label: string; ids: string[] }> = [
  { key: "view", label: "I can see you", ids: ["no_person"] },
  { key: "facing", label: "Facing the right way", ids: ["face_front", "turn_side", "wrong_side"] },
  { key: "fit", label: "Your whole body fits, with room to move", ids: ["too_close", "tilt_up", "tilt_down", "too_far", "too_close_wide"] },
  { key: "posture", label: "Sitting or standing, as the exercise needs", ids: ["sit_down", "stand_up"] },
  { key: "still", label: "Hold still for a moment", ids: ["hold_still"] },
];

/**
 * The checklist for the current issue. `locked` = placed: every step done.
 * An unknown issue id marks the first step as the one being worked on.
 */
export function positioningSteps(issueId: string | null, locked: boolean): PositioningStep[] {
  let nowAt = locked ? STEPS.length : STEPS.findIndex((s) => issueId !== null && s.ids.includes(issueId));
  if (nowAt < 0) nowAt = issueId === null ? STEPS.length - 1 : 0;
  return STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    status: i < nowAt ? "done" : i === nowAt ? "now" : "todo",
  }));
}
