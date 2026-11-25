import { describe, expect, it } from "vitest";
import {
  assessPosition, positionSetupFor, PositionTracker, silhouetteFor,
  LOCK_STILL_MS, ISSUE_SETTLE_MS, UNLOCK_AFTER_MS, type PositionAssessment,
} from "@/lib/positioning/positionCoach";
import { buildPrescription } from "@/lib/sessions/buildSessionPrescription";
import { frameFromPixels, place, seatedSide, standingFront, standingSide, type PixelBody } from "@/lib/testing/poses";

const W = 1280, H = 720;
const setupOf = (slug: string, start = 0, norm = 160, min = 110) =>
  positionSetupFor(buildPrescription(slug, slug, 3, 2000, {}, start, norm, min, null, null)!);

const ABD_R = setupOf("shoulder_abduction_right", 0, 150, 100);
const ABD_BOTH = setupOf("shoulder_abduction_bilateral", 0, 150, 100);
const FLEX_R = setupOf("shoulder_flexion_right");
const KNEE_R = setupOf("knee_extension_right", 90, 0, 30);
const STS = setupOf("sit_to_stand", 90, 160, 80);

const at = (body: PixelBody, opts: Parameters<typeof frameFromPixels>[3] = {}) => frameFromPixels(body, W, H, opts);

// Bodies placed so the movement fits: arms-up exercises need the
// shoulders low enough that a raised arm stays in frame.
const goodFront = () => place(standingFront(), 0.62, 640, 470);
const goodSide = () => place(standingSide(), 0.7, 640, 480);
const goodSeatedSide = () => place(seatedSide(90), 0.7, 560, 430);

describe("what each exercise asks for", () => {
  it("uses the camera side the measurement needs", () => {
    expect(ABD_R).toMatchObject({ view: "front", reach: "arm_up_side" });
    expect(FLEX_R).toMatchObject({ view: "side", side: "right", reach: "arm_up_forward" });
    expect(KNEE_R).toMatchObject({ view: "side", posture: "seated", reach: "leg_forward" });
    expect(STS).toMatchObject({ view: "side", posture: "seated", coverage: "full_body", reach: "stand_up" });
    expect(silhouetteFor(ABD_R)).toBe("front_upper");
    expect(silhouetteFor(KNEE_R)).toBe("side_seated");
  });
});

describe("assessPosition", () => {
  it("nobody there", () => {
    expect(assessPosition(null, ABD_R).issue?.id).toBe("no_person");
  });

  it("well placed for an arm-out raise", () => {
    const a = assessPosition(at(goodFront()), ABD_R);
    expect(a.issue).toBeNull();
    expect(a.ok).toBe(true);
  });

  it("asks a side-on patient to face the screen for arm-out raises", () => {
    expect(assessPosition(at(goodSide()), ABD_R).issue?.id).toBe("face_front");
  });

  it("asks a front-facing patient to turn side-on for forward raises", () => {
    const a = assessPosition(at(goodFront()), FLEX_R);
    expect(a.issue?.id).toBe("turn_side");
    expect(a.issue?.say).toContain("right side");
  });

  it("notices the wrong side is toward the camera", () => {
    const b = goodSide();
    const scores = { right_shoulder: 0.55, right_elbow: 0.55, right_hip: 0.55, right_knee: 0.55, left_shoulder: 0.99, left_elbow: 0.99, left_hip: 0.99, left_knee: 0.99 };
    expect(assessPosition(at(b, { scores }), FLEX_R).issue?.id).toBe("wrong_side");
  });

  it("well placed side-on for a forward raise", () => {
    expect(assessPosition(at(goodSide()), FLEX_R).issue).toBeNull();
  });

  it("too close: arms would leave the top of the frame", () => {
    const a = assessPosition(at(place(standingFront(), 1.15, 640, 400)), ABD_R);
    expect(["too_close", "tilt_up"]).toContain(a.issue?.id);
    expect(a.issue?.say).toMatch(/arms/);
  });

  it("too far", () => {
    expect(assessPosition(at(place(standingFront(), 0.3, 640, 450)), ABD_R).issue?.id).toBe("too_far");
  });

  it("off to one side: says which way in the patient's terms, arrow on screen", () => {
    // Body at image-left in the raw camera = the patient's right; they step to their left.
    const a = assessPosition(at(place(standingFront(), 0.62, 330, 470)), ABD_R, { mirrored: true });
    expect(a.issue?.id).toBe("move_left");
    expect(a.issue?.say).toBe("Take a small step to your left.");
    expect(a.issue?.arrow).toBe("left"); // in a mirrored preview your left is screen-left
    const b = assessPosition(at(place(standingFront(), 0.62, 330, 470)), ABD_R, { mirrored: false });
    expect(b.issue?.arrow).toBe("right"); // rear camera, not mirrored
  });

  it("both arms out need room on both sides", () => {
    expect(assessPosition(at(goodFront()), ABD_BOTH).issue).toBeNull();
    // Near the right edge of the camera image: the left arm would leave the frame.
    const a = assessPosition(at(place(standingFront(), 0.62, 1050, 470)), ABD_BOTH);
    expect(a.issue?.id).toBe("move_right");
  });

  it("knees: needs the feet; asks to tilt down when they are cut off", () => {
    const b = goodSeatedSide();
    expect(assessPosition(at(b), KNEE_R).issue).toBeNull();
    const cut = assessPosition(at(b, { scores: { left_ankle: 0.1, right_ankle: 0.1 } }), KNEE_R);
    expect(cut.issue?.id).toBe("tilt_down");
  });

  it("sit to stand: standing patient is asked to sit; seated needs room to stand", () => {
    expect(assessPosition(at(goodSide()), STS).issue?.id).toBe("sit_down");
    expect(assessPosition(at(place(seatedSide(90), 0.6, 560, 470)), STS).issue).toBeNull();
    const headAtTop = assessPosition(at(place(seatedSide(90), 0.6, 560, 260)), STS);
    expect(headAtTop.issue?.id).toBe("tilt_up");
  });
});

describe("PositionTracker", () => {
  const ok = (cx = 0.5): PositionAssessment => ({ ok: true, issue: null, body: { cx, top: 0.1, bottom: 0.9 } });
  const bad = (id: string): PositionAssessment => ({ ok: false, body: null, issue: { id, say: id, retry: id, arrow: null } });

  it("holds still, then locks in", () => {
    const t = new PositionTracker();
    expect(t.update(ok(), 0).state).toBe("hold_still");
    expect(t.update(ok(), LOCK_STILL_MS - 10).state).toBe("hold_still");
    expect(t.update(ok(), LOCK_STILL_MS).state).toBe("locked");
  });

  it("moving resets the hold", () => {
    const t = new PositionTracker();
    t.update(ok(0.5), 0);
    t.update(ok(0.6), 1000); // moved
    expect(t.update(ok(0.6), LOCK_STILL_MS).state).toBe("hold_still");
    expect(t.update(ok(0.6), 1000 + LOCK_STILL_MS).state).toBe("locked");
  });

  it("does not flicker between instructions", () => {
    const t = new PositionTracker();
    expect(t.update(bad("too_far"), 0).issue?.id).toBe("too_far");
    expect(t.update(bad("move_left"), 100).issue?.id).toBe("too_far");
    expect(t.update(bad("move_left"), 100 + ISSUE_SETTLE_MS).issue?.id).toBe("move_left");
  });

  it("once locked, a brief problem is ignored; a lasting one unlocks", () => {
    const t = new PositionTracker();
    t.update(ok(), 0);
    t.update(ok(), LOCK_STILL_MS);
    expect(t.update(bad("too_close"), 2000).state).toBe("locked");
    expect(t.update(ok(), 2500).state).toBe("locked");
    t.update(bad("too_close"), 3000);
    expect(t.update(bad("too_close"), 3000 + UNLOCK_AFTER_MS).state).toBe("adjusting");
  });
});

describe("arm forward with camera_position either / front", () => {
  const withCam = (camera: string) =>
    positionSetupFor(buildPrescription("shoulder_flexion_right", "x", 3, 2000, {}, 0, 160, 110, null, null, { cameraPosition: camera, patientPosition: "either" })!);
  const EITHER = withCam("either");
  const FRONT = withCam("front");

  it("asks for the view the physio chose, front outline first", () => {
    expect(EITHER).toMatchObject({ view: "either", reach: "arm_up_forward", posture: "either" });
    expect(FRONT.view).toBe("front");
    expect(withCam("side").view).toBe("side");
    expect(silhouetteFor(EITHER)).toBe("front_upper");
  });

  it("either: facing the screen is fine", () => {
    expect(assessPosition(at(goodFront()), EITHER, { mirrored: false }).ok).toBe(true);
  });

  it("either: side on is fine too", () => {
    expect(assessPosition(at(goodSide()), EITHER, { mirrored: false }).ok).toBe(true);
  });

  it("either: half turned is not", () => {
    const b = goodFront();
    // Squeeze the shoulders together: about 45° turned.
    const mx = (b.left_shoulder!.x + b.right_shoulder!.x) / 2;
    b.left_shoulder = { x: mx + 30, y: b.left_shoulder!.y };
    b.right_shoulder = { x: mx - 30, y: b.right_shoulder!.y };
    expect(assessPosition(at(b), EITHER, { mirrored: false }).issue?.id).toBe("face_front");
  });

  it("front: side on is told to face the screen", () => {
    expect(assessPosition(at(goodSide()), FRONT, { mirrored: false }).issue?.id).toBe("face_front");
  });

  it("facing the camera needs no room to the side for the forward arm", () => {
    // Near the right edge of the frame, but body inside: fine facing front.
    const b = place(standingFront(), 0.62, 640 + 300, 470);
    const a = assessPosition(at(b), FRONT, { mirrored: false });
    expect(a.issue?.id ?? "ok").not.toBe("too_close_wide");
  });

  it("the default (no setting) is still side on", () => {
    expect(FLEX_R.view).toBe("side");
  });
});
