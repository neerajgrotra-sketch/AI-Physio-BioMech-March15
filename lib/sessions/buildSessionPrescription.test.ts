// End-to-end: every system exercise, built from its real template values
// (supabase/seed.sql), fed a simulated rep frame by frame through the same
// steps as the live loop. Each must count a good rep, and fail a bad one
// for the right reason.
import { describe, expect, it } from "vitest";
import { buildPrescription } from "@/lib/sessions/buildSessionPrescription";
import { FlexionViewEstimator } from "@/lib/biomechanics/flexionView";
import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
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

describe("at a desk: the owner's test (front view, hand resting on the desk between reps)", () => {
  const slug = "shoulder_flexion_right";
  const p = (() => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
  })();
  const near = { seated: true, camPx: 700 };
  const DESK = 35; // upper arm ~35° forward with the hand on the desk

  it("three reps from a desk rest all count", () => {
    const h = p.hold.durationMs + 600;
    const rep: Array<[number, (u: number) => number]> = [[1200, ramp(DESK, 140)], [h, hold(140)], [1200, ramp(140, DESK)], [1000, hold(DESK)]];
    const pts = timeline([
      [2500, hold(3)],      // sitting down, arm hanging, not yet in position
      [3500, hold(DESK)],   // in position, hand on the desk
      ...rep, ...rep, ...rep,
    ]);
    const fr = pts.map(({ t, v }) => frameFromPixels(flexionFront(v, near), 1280, 720, { timestamp: t }));
    const r = replay(p, fr, { positioned: (i) => pts[i].t >= 2500 });
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(3);
  });
});

describe("the owner's session log of 2026-11-26, replayed", () => {
  // From session_debug_logs: hold at ~125°, back to ~33° (never below the
  // old 20° finish), raise again to ~114° with a long hold, back to ~30°.
  // 0 reps counted then; the rep now counts when the hold is done.
  const slug = "shoulder_flexion_right";
  const p = (() => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 6, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
  })();
  const pts = timeline([
    [4000, hold(33)],
    [900, ramp(33, 125)], [2400, hold(124)], [1500, ramp(124, 33)], [2500, hold(33)],
    [700, ramp(33, 114)], [8000, hold(112)], [1200, ramp(112, 30)], [3000, hold(30)],
  ]);
  const fr = pts.map(({ t, v }) => frameFromPixels(flexionFront(v, { seated: true }), 1280, 720, { timestamp: t }));

  it("counts both reps, each when its hold is done", () => {
    const r = replay(p, fr);
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(2);
    // Counted during the hold (before the arm came down), not at rest.
    const firstRep = r.events.find((e) => e.kind === "rep")!;
    expect(firstRep.t).toBeLessThan(4000 + 900 + 2400 + 300);
  });

  it("raising again before resting fully still starts the next rep", () => {
    const pts2 = timeline([
      [4000, hold(33)],
      [900, ramp(33, 125)], [2400, hold(124)], [1200, ramp(124, 60)], [900, ramp(60, 125)], [2400, hold(124)], [1500, ramp(124, 33)], [1000, hold(33)],
    ]);
    const r = replay(p, pts2.map(({ t, v }) => frameFromPixels(flexionFront(v, { seated: true }), 1280, 720, { timestamp: t })));
    expect(r.repCount).toBe(2);
  });
});

describe("the owner's session of 2026-11-26 (v0.3.0): hands resting on the lap", () => {
  // Log: every rep held 2 s at 110-125° and then failed "keep the other arm
  // still", because the resting left arm read 40-60° (> an absolute 35°).
  const slug = "shoulder_flexion_right";
  const p = (() => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 6, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
  })();
  const lap = { seated: true, restDeg: 48 }; // the other arm rests ~48° forward
  const rep: Array<[number, (u: number) => number]> = [[900, ramp(48, 120)], [2600, hold(120)], [1000, ramp(120, 48)], [1500, hold(48)]];

  // Settling in first with both arms hanging (as in the real run: the app
  // learns the true arm length), then hands on the lap.
  const settle = (t: number) => t < 3000;
  const body = (t: number, v: number, extra = {}) =>
    settle(t) ? flexionFront(3, { seated: true, restDeg: 3 }) : flexionFront(v, { ...lap, ...extra });

  it("the resting other arm really reads above the old 35° limit (as in the log)", () => {
    const pts = timeline([[3000, hold(3)], [3000, hold(48)]]);
    const est = new FlexionViewEstimator();
    let left = 0;
    for (const { t, v } of pts) {
      const f = extractMovementFeatures(frameFromPixels(body(t, v), 1280, 720, { timestamp: t }));
      est.apply(f);
      left = f.leftArmElevationDeg ?? 0;
    }
    expect(left).toBeGreaterThan(35);
  });

  it("each held rep counts", () => {
    const pts = timeline([[3000, hold(3)], [4000, hold(48)], ...rep, ...rep, ...rep]);
    const r = replay(p, pts.map(({ t, v }) => frameFromPixels(body(t, v), 1280, 720, { timestamp: t })), { positioned: (i) => pts[i].t >= 3000 });
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(3);
  });

  it("but lifting the other arm well above its rest still fails", () => {
    const pts = timeline([[3000, hold(3)], [4000, hold(48)], ...rep]);
    // Both arms go up together.
    const fr = pts.map(({ t, v }) => frameFromPixels(body(t, v, { side: "both" }), 1280, 720, { timestamp: t }));
    const r = replay(p, fr, { positioned: (i) => pts[i].t >= 3000 });
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_isolation");
  });
});

describe("forward raise done out to the side instead (the owner's trick)", () => {
  const slug = "shoulder_flexion_right";
  const p = (() => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
  })();

  it("raising the arm sideways to the same height fails as form, not counted", () => {
    const pts = oneRep(5, 125, p.hold.durationMs);
    const fr = pts.map(({ t, v }) => frameFromPixels(standingFront({ rightArmDeg: v, leftArmDeg: 5 }), 1280, 720, { timestamp: t }));
    const r = replay(p, fr);
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_form");
  });

  it("the proper forward raise still counts", () => {
    const pts = oneRep(5, 125, p.hold.durationMs);
    const r = replay(p, pts.map(({ t, v }) => frameFromPixels(flexionFront(v), 1280, 720, { timestamp: t })));
    expect(r.repCount).toBe(1);
  });
});

describe("raised out to the side, then brought in front while up (the owner's case)", () => {
  const slug = "shoulder_flexion_right";
  const p = (() => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
  })();
  // Each segment: [ms, elevation(u), outward(u)]
  const path = (segs: Array<[number, (u: number) => number, (u: number) => number]>) => {
    const out: Array<{ t: number; v: number; o: number }> = [];
    let t0 = 0;
    for (const [ms, ev, ov] of segs) {
      const n = Math.round((ms / 1000) * 30);
      for (let i = 0; i < n; i++) out.push({ t: t0 + (i * 1000) / 30, v: ev(i / n), o: ov(i / n) });
      t0 += (n * 1000) / 30;
    }
    return out;
  };
  const frames = (pts: Array<{ t: number; v: number; o: number }>) =>
    pts.map(({ t, v, o }) => frameFromPixels(flexionFront(v, { outDeg: o }), 1280, 720, { timestamp: t }));

  it("counts once the arm is held in front (the hold starts when it gets there)", () => {
    const pts = path([
      [3500, hold(5), hold(90)],                 // rest
      [1000, ramp(5, 120), hold(90)],            // up, out to the side
      [1200, hold(120), ramp(90, 0)],            // swept in front while up
      [p.hold.durationMs + 600, hold(120), hold(0)], // held in front
      [1000, ramp(120, 5), hold(0)],
      [800, hold(5), hold(0)],
    ]);
    const r = replay(p, frames(pts));
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(1);
  });

  it("held out to the side the whole time: no hold, and it fails as form when lowered", () => {
    const pts = path([
      [3500, hold(5), hold(90)],
      [1000, ramp(5, 120), hold(90)],
      [p.hold.durationMs + 600, hold(120), hold(90)],
      [1000, ramp(120, 5), hold(90)],
      [800, hold(5), hold(90)],
    ]);
    const r = replay(p, frames(pts));
    expect(r.events.some((e) => e.kind === "hold")).toBe(false);
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_form");
  });

  it("drifting out mid-hold for longer than the slip grace pauses the hold; back in front, it resumes (not from zero)", () => {
    const pts = path([
      [3500, hold(5), hold(0)],
      [1000, ramp(5, 120), hold(0)],
      [500, hold(120), hold(0)],                // 0.5 s of a 2 s hold
      [1800, hold(120), hold(90)],              // out to the side for 1.8 s: past the 1 s grace, the hold pauses
      [p.hold.durationMs + 600, hold(120), hold(0)], // back in front: the rest of the hold
      [1000, ramp(120, 5), hold(0)],
      [800, hold(5), hold(0)],
    ]);
    const r = replay(p, frames(pts));
    expect(r.repCount).toBe(1);
    const rep = r.events.find((e) => e.kind === "rep")!;
    const back = 3500 + 1000 + 500 + 1800;
    expect(rep.t).toBeGreaterThan(back);                              // not during the drift
    expect(rep.t).toBeLessThan(back + p.hold.durationMs - 300);       // resumed: well before a full new hold
  });

  it("a brief drift out (under the slip grace) doesn't interrupt the hold", () => {
    const pts = path([
      [3500, hold(5), hold(0)],
      [1000, ramp(5, 120), hold(0)],
      [700, hold(120), hold(0)],
      [500, hold(120), hold(90)],               // half a second out to the side
      [p.hold.durationMs, hold(120), hold(0)],
      [1000, ramp(120, 5), hold(0)],
      [800, hold(5), hold(0)],
    ]);
    const r = replay(p, frames(pts));
    expect(r.repCount).toBe(1);
    const rep = r.events.find((e) => e.kind === "rep")!;
    expect(rep.t).toBeLessThan(3500 + 1000 + p.hold.durationMs + 400); // finished on time
  });

  it("an arm 70° out (a slightly outward lift) still holds and counts", () => {
    const pts = path([
      [3500, hold(5), hold(0)],
      [1000, ramp(5, 120), hold(0)],
      [p.hold.durationMs + 600, hold(120), hold(70)],
      [1000, ramp(120, 5), hold(0)],
      [800, hold(5), hold(0)],
    ]);
    expect(replay(p, frames(pts)).repCount).toBe(1);
  });
});

describe("lifting the wrong arm (left, in a right-arm exercise)", () => {
  it("is neither a rep nor a failed rep; the right arm then counts normally", () => {
    const slug = "shoulder_flexion_right";
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    const p = buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
    const wrong = timeline([[3500, hold(5)], [1000, ramp(5, 130)], [holdMs + 600, hold(130)], [1000, ramp(130, 5)], [800, hold(5)]]);
    const right = timeline([[1000, ramp(5, 130)], [holdMs + 600, hold(130)], [1000, ramp(130, 5)], [800, hold(5)]]);
    const t0 = wrong[wrong.length - 1].t + 33;
    const fr = [
      ...wrong.map(({ t, v }) => frameFromPixels(flexionFront(v, { side: "left" }), 1280, 720, { timestamp: t })),
      ...right.map(({ t, v }) => frameFromPixels(flexionFront(v), 1280, 720, { timestamp: t0 + t })),
    ];
    const r = replay(p, fr);
    expect(r.events.filter((e) => e.kind === "fail")).toEqual([]);
    expect(r.repCount).toBe(1);
  });
});

describe("lifting only the upper arm, forearm hanging (the owner's test)", () => {
  const slug = "shoulder_flexion_right";
  const p = (() => {
    const [start, norm, min, holdMs] = TEMPLATES[slug];
    return buildPrescription(slug, slug, 3, holdMs, {}, start, norm, min, null, null, { cameraPosition: "either", patientPosition: "either" })!;
  })();
  const elbowOnly = (v: number) => {
    const b = flexionFront(v);
    if (v > 40) b.right_wrist = { x: b.right_elbow!.x, y: b.right_elbow!.y + 120 }; // forearm hangs straight down
    return b;
  };

  it("never holds, and fails as 'keep your arm straight' when lowered", () => {
    const pts = oneRep(5, 120, p.hold.durationMs);
    const r = replay(p, pts.map(({ t, v }) => frameFromPixels(elbowOnly(v), 1280, 720, { timestamp: t })));
    expect(r.events.some((e) => e.kind === "hold")).toBe(false);
    expect(r.repCount).toBe(0);
    expect(r.events.find((e) => e.kind === "fail")?.reason).toBe("failed_straight_arm");
  });

  it("straightening the arm at the top starts the hold, and the rep counts", () => {
    const pts = timeline([
      [3500, hold(5)], [1000, ramp(5, 120)],
      [1000, hold(120)],                       // bent at the top: waits
      [p.hold.durationMs + 600, hold(121)],    // straightened (marked by 121)
      [1000, ramp(121, 5)], [800, hold(5)],
    ]);
    const fr = pts.map(({ t, v }) => frameFromPixels(v === 120 ? elbowOnly(v) : flexionFront(v), 1280, 720, { timestamp: t }));
    const r = replay(p, fr);
    expect(r.repCount).toBe(1);
  });
});
