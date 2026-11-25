// End-to-end: every system exercise, built from its real template values
// (supabase/seed.sql), fed a simulated rep frame by frame through the same
// steps as the live loop. Each must count a good rep, and fail a bad one
// for the right reason.
import { describe, expect, it } from "vitest";
import { buildPrescription } from "@/lib/sessions/buildSessionPrescription";
import { frameFromPixels, flexionFront, flexionSide, seatedSide, standingFront, standingSide, type PixelBody } from "@/lib/testing/poses";
import { hold, ramp, replay, timeline } from "@/lib/testing/replay";
import type { PoseFrame } from "@/lib/types/pose";

// slug: [rom_start, rom_norm, rom_acceptable_min, default_hold_ms], as live.
const TEMPLATES: Record<string, [number, number, number, number]> = {
  shoulder_flexion_right: [0, 160, 110, 2000],
  shoulder_flexion_left: [0, 160, 110, 2000],
  shoulder_flexion_bilateral: [0, 160, 110, 3000],
  shoulder_abduction_right: [0, 150, 100, 3000],
  shoulder_abduction_left: [0, 150, 110, 3000],
  shoulder_abduction_bilateral: [0, 150, 100, 3000],
  knee_extension_right: [90, 0, 30, 3000],
  knee_extension_left: [90, 0, 30, 3000],
  knee_extension_bilateral: [90, 0, 30, 3000],
  sit_to_stand: [90, 160, 80, 3000],
};

const build = (slug: string, reps = 3) => {
  const [start, norm, min, holdMs] = TEMPLATES[slug];
  const p = buildPrescription(slug, slug, reps, holdMs, {}, start, norm, min, null, null);
  if (!p) throw new Error(`no prescription for ${slug}`);
  return p;
};

/** The pose for an exercise at a given joint value. */
function poseFor(slug: string, v: number): PixelBody {
  if (slug.startsWith("shoulder_flexion")) {
    const side = slug.endsWith("right") ? "right" : slug.endsWith("left") ? "left" : "both";
    return flexionSide(v, side);
  }
  if (slug.startsWith("shoulder_abduction")) {
    if (slug.endsWith("right")) return standingFront({ rightArmDeg: v });
    if (slug.endsWith("left")) return standingFront({ leftArmDeg: v });
    return standingFront({ rightArmDeg: v, leftArmDeg: v });
  }
  if (slug.startsWith("knee_extension")) {
    if (slug.endsWith("left")) return seatedSide(90, v);
    if (slug.endsWith("right")) return seatedSide(v, 90);
    return seatedSide(v, v);
  }
  throw new Error(slug);
}

/** One raise-hold-lower rep after a still start (long enough for calibration). */
function oneRep(rest: number, peak: number, holdMs: number) {
  return timeline([
    [3500, hold(rest)],      // still: calibration window
    [1000, ramp(rest, peak)],
    [holdMs + 600, hold(peak)],
    [1000, ramp(peak, rest)],
    [1000, hold(rest)],
  ]);
}

const frames = (slug: string, pts: Array<{ t: number; v: number }>, drop?: (t: number) => boolean): PoseFrame[] =>
  pts.map(({ t, v }) =>
    drop?.(t)
      ? { timestamp: t, landmarks: {}, personDetected: true, sourceWidth: 1280, sourceHeight: 720 }
      : frameFromPixels(poseFor(slug, v), 1280, 720, { timestamp: t })
  );

const REST: Record<string, number> = { flexion: 5, abduction: 5, knee: 90 };
const PEAK: Record<string, number> = { flexion: 140, abduction: 140, knee: 175 };
const kind = (slug: string) => (slug.includes("flexion") ? "flexion" : slug.includes("abduction") ? "abduction" : "knee");

describe("every raise-hold-lower exercise counts one good rep", () => {
  for (const slug of Object.keys(TEMPLATES).filter((s) => s !== "sit_to_stand")) {
    it(slug, () => {
      const p = build(slug);
      const r = replay(p, frames(slug, oneRep(REST[kind(slug)], PEAK[kind(slug)], p.hold.durationMs)));
      expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
      expect(r.repCount).toBe(1);
    });
  }
});

describe("bad reps fail for the right reason", () => {
  it("a raise that stops short fails on height", () => {
    const slug = "shoulder_flexion_right";
    const p = build(slug);
    const r = replay(p, frames(slug, oneRep(5, 80, p.hold.durationMs)));
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_height");
  });

  it("a hold cut short fails on the hold", () => {
    const slug = "shoulder_abduction_right";
    const p = build(slug);
    const r = replay(p, frames(slug, oneRep(5, 140, 800)));
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_hold");
  });

  it("raising the other arm fails on isolation", () => {
    const slug = "shoulder_abduction_right";
    const p = build(slug);
    const pts = oneRep(5, 140, p.hold.durationMs);
    const fr = pts.map(({ t, v }) => frameFromPixels(standingFront({ rightArmDeg: v, leftArmDeg: v }), 1280, 720, { timestamp: t }));
    const r = replay(p, fr);
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_isolation");
  });

  it("both knees: only one leg straightening does not count", () => {
    const slug = "knee_extension_bilateral";
    const p = build(slug);
    const pts = oneRep(90, 175, p.hold.durationMs);
    const fr = pts.map(({ t, v }) => frameFromPixels(seatedSide(v, 90), 1280, 720, { timestamp: t }));
    expect(replay(p, fr).repCount).toBe(0);
  });
});

describe("tracking glitches do not fail reps", () => {
  it("a 300 ms tracking dropout in the middle of the hold", () => {
    const slug = "shoulder_abduction_right";
    const p = build(slug);
    const pts = oneRep(5, 140, p.hold.durationMs);
    const holdMid = 3500 + 1000 + 1200;
    const r = replay(p, frames(slug, pts, (t) => t > holdMid && t < holdMid + 300));
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(1);
  });

  it("a one-frame wild reading", () => {
    const slug = "shoulder_flexion_right";
    const p = build(slug);
    const pts = oneRep(5, 140, p.hold.durationMs).map((s, i) => (i === 150 ? { ...s, v: 10 } : s));
    expect(replay(p, frames(slug, pts)).repCount).toBe(1);
  });
});

describe("sit to stand", () => {
  const sts = (segments: Array<[number, "sit" | "stand"]>) => {
    let t = 0;
    const out: PoseFrame[] = [];
    for (const [ms, pose] of segments) {
      for (let i = 0; i < ms / (1000 / 30); i++) {
        out.push(frameFromPixels(pose === "sit" ? seatedSide(90) : standingSide(), 1280, 720, { timestamp: t }));
        t += 1000 / 30;
      }
    }
    return out;
  };

  it("sit, stand and hold, sit: one rep", () => {
    const p = build("sit_to_stand");
    const r = replay(p, sts([[2000, "sit"], [p.hold.durationMs + 1000, "stand"], [2000, "sit"]]));
    expect(r.repCount).toBe(1);
  });

  it("sitting back down before the hold ends fails on the hold (used to pass)", () => {
    const p = build("sit_to_stand");
    const r = replay(p, sts([[2000, "sit"], [800, "stand"], [3000, "sit"]]));
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_hold");
  });
});

describe("arm forward facing the camera (camera_position front or either)", () => {
  const slug = "shoulder_flexion_right";
  const front = (pts: Array<{ t: number; v: number }>, opts: Parameters<typeof flexionFront>[1] = {}) =>
    pts.map(({ t, v }) => frameFromPixels(flexionFront(v, opts), 1280, 720, { timestamp: t }));
  const buildWith = (camera: string | null, posture: string | null = null) => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: camera, patientPosition: posture })!;
  };

  it("a good rep counts, standing", () => {
    const p = buildWith("either");
    const r = replay(p, front(oneRep(3, 140, p.hold.durationMs)));
    expect(r.view).toBe("front");
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(1);
  });

  it("a good rep counts, seated", () => {
    const p = buildWith("either", "either");
    const r = replay(p, front(oneRep(3, 140, p.hold.durationMs), { seated: true }));
    expect(r.repCount).toBe(1);
  });

  it("three reps in a row", () => {
    const p = buildWith("front");
    const h = p.hold.durationMs + 600;
    const rep: Array<[number, (u: number) => number]> = [[1000, ramp(3, 140)], [h, hold(140)], [1000, ramp(140, 3)], [800, hold(3)]];
    const r = replay(p, front(timeline([[3500, hold(3)], ...rep, ...rep, ...rep])));
    expect(r.repCount).toBe(3);
  });

  it("stopping at 90° (below the 110° pass mark) fails on height", () => {
    const p = buildWith("either");
    const r = replay(p, front(oneRep(3, 90, p.hold.durationMs)));
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_height");
  });

  it("raising the other arm too fails on isolation", () => {
    const p = buildWith("either");
    const r = replay(p, front(oneRep(3, 140, p.hold.durationMs), { side: "both" }));
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_isolation");
  });
});

describe("the exercise library's Clinical Setup is honoured", () => {
  const b = (slug: string, camera: string | null, posture: string | null) => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: camera, patientPosition: posture })!;
  };

  it("camera_position and patient_position reach the prescription", () => {
    const p = b("shoulder_flexion_right", "either", "seated");
    expect(p.camera).toBe("either");
    expect(p.posture).toBe("seated");
    expect(p.framing.requiredStartPosture).toBe("seated");
  });

  it("unknown values are ignored", () => {
    const p = b("shoulder_flexion_right", "ceiling", "lying");
    expect(p.camera).toBeUndefined();
    expect(p.posture).toBe("either");
  });

  it("knee exercises keep their seated start whatever the setting", () => {
    const p = b("knee_extension_right", "front", "standing");
    expect(p.posture).not.toBe("standing");
  });
});
