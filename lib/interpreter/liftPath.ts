// ============================================================
// lib/interpreter/liftPath.ts
// ============================================================
// Forward raise or side raise? Judged on the way UP, not at the top.
//
// The owner (v0.10.0): "there is no reliable way for the system to be sure
// the user is doing flexion or abduction; the user can achieve the same with
// abduction". At the top both movements end near overhead, and there the
// plane reading (0 in front, 90 out to the side) is weak: genuine forward
// holds read 50-70° in the owner's runs, so the top limit had to go to 75°
// (85° Gentle), which a side raise near overhead also gets under. Through
// mid-range the two are far apart: forward lifts read 25-45° (the owner's
// v0.10.0 run, both arms), a side raise 80-90°. So the plane is sampled
// while the arm climbs through MID_LO..MID_HI (the measured angle), and if
// its middle value is beyond the path limit the rep went out to the side:
// it can't be held and fails as failed_form, whatever the arm does at the
// top. (This replaces the earlier allowance, from the owner's first runs, for
// lifting sideways and swinging the arm in front at the top: that is a side
// raise finished forward, not a forward raise.)
//
// The path limit follows the patient's sideways allowance (the top limit),
// PATH_MARGIN tighter: Standard 75 -> 60, Gentle 85 -> 70, Strict 60 -> 45.
// Pure. Tested by liftPath.test.ts.
// ============================================================

export const MID_LO = 45;
export const MID_HI = 100;
export const PATH_MARGIN = 15;
export const PATH_MIN_SAMPLES = 4;
const MAX_SAMPLES = 90;

/** The plane readings of this lift through mid-range (a new list; empty again at rest). */
export function nextPath(samples: number[], phase: string, metric: number | null, plane: number | null | undefined): number[] {
  if (metric === null) return samples;
  if (phase === "ready" && metric < MID_LO) return samples.length ? [] : samples;
  // Only once the lift has started (an arm resting on a desk at 45-55° must
  // not count).
  if (phase === "lifting" && metric >= MID_LO && metric <= MID_HI && plane !== null && plane !== undefined) {
    return samples.length >= MAX_SAMPLES ? samples : [...samples, plane];
  }
  return samples;
}

export const pathLimit = (maxPlaneDeg: number) => maxPlaneDeg - PATH_MARGIN;

/** "sideways" once enough of the climb was out to the side, "forward" once enough was in front, else null (not judged yet). */
export function pathVerdict(samples: number[], maxPlaneDeg: number): "forward" | "sideways" | null {
  if (samples.length < PATH_MIN_SAMPLES) return null;
  const s = [...samples].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  return median > pathLimit(maxPlaneDeg) ? "sideways" : "forward";
}
