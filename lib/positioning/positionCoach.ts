// ============================================================
// lib/positioning/positionCoach.ts
// ============================================================
// Gets the patient into a position where the camera can measure
// the exercise, before it starts and between reps.
//
//   assessPosition(frame, setup)  pure: one frame -> the first thing
//                                 to fix (or ok), plus the guide
//   PositionTracker               steadies that over time: an
//                                 instruction must last 500 ms before
//                                 it replaces the last one, and a good
//                                 position must be held still 1.5 s
//                                 to lock in (and then stays locked
//                                 unless something serious is wrong
//                                 for 3 s; small shifts are tolerated)
//   positionSetupFor(prescription) what each exercise needs
//
// Checks, in order; the first that fails is the one instruction given:
//   1. in view        2. facing the right way (front / side, which side)
//   3. fits top to bottom, with room for the movement's peak
//   4. not too far     5. room left and right (and roughly centred)
//   6. seated / standing as required
// Geometry is in true image proportions (see extractMovementFeatures):
// x is scaled by width/height, so the frame is A = width/height wide
// and 1 tall.
// Tested by lib/positioning/positionCoach.test.ts.
// ============================================================

import { extractMovementFeatures } from "@/lib/biomechanics/extractMovementFeatures";
import type { ExercisePrescription, MetricSource } from "@/lib/types/exercise";
import type { PoseFrame } from "@/lib/types/pose";

// A landmark counts as seen for positioning at this score (stricter than
// for measuring, so the patient is placed where tracking is solid).
export const POSITION_MIN_SCORE = 0.5;

// "either": front or side on are both fine (front is the default shown).
export type CameraView = "front" | "side" | "either";
export type Coverage = "upper_body" | "torso_and_hips" | "full_body";
export type Reach = "arm_up_forward" | "arm_up_side" | "leg_forward" | "stand_up" | "none";
export type Silhouette = "front_upper" | "front_standing" | "front_seated" | "side_upper" | "side_seated" | "side_standing";

export type PositionSetup = {
  view: CameraView;
  side: "left" | "right" | "both" | "center";
  posture: "seated" | "standing" | "either";
  coverage: Coverage;
  reach: Reach;
};

export type Arrow = "left" | "right" | "back" | "closer" | "turn" | "tilt_up" | "tilt_down" | "sit" | "stand" | null;

export type PositionIssue = {
  id: string;
  say: string;        // spoken and shown
  retry: string;      // a shorter repeat
  arrow: Arrow;       // in DISPLAY terms (screen left/right)
};

export type PositionAssessment = {
  ok: boolean;
  issue: PositionIssue | null;
  /** Body centre (x in 0..1 of width) and height span, for the stillness check. */
  body: { cx: number; top: number; bottom: number } | null;
};

// ── What each exercise needs ────────────────────────────────

const ARM_FLEXION: MetricSource[] = ["rightArmElevationDeg", "leftArmElevationDeg", "bilateralArmElevationDeg"];
const ARM_ABDUCTION: MetricSource[] = ["rightShoulderAbductionDeg", "leftShoulderAbductionDeg", "bilateralShoulderAbductionDeg"];
const KNEE: MetricSource[] = ["rightKneeExtensionDeg", "leftKneeExtensionDeg", "bilateralKneeExtensionDeg", "kneeToHipExtensionScore"];

export function positionSetupFor(p: ExercisePrescription): PositionSetup {
  const metric = p.target.metric;
  const side = p.side;
  const posture = (p.framing?.requiredStartPosture ?? p.posture ?? "either") as PositionSetup["posture"];

  if (p.template === "rise_hold_lower") {
    // Sit to stand: side on, whole body, room to stand up.
    return { view: "side", side: "center", posture: "seated", coverage: "full_body", reach: "stand_up" };
  }
  if (KNEE.includes(metric)) {
    // The lower leg swings toward a front camera, so knees are measured side on.
    return { view: "side", side, posture: "seated", coverage: "torso_and_hips", reach: "leg_forward" };
  }
  if (ARM_FLEXION.includes(metric)) {
    // Side on reads the angle directly. Facing the camera it is worked out
    // from the elbow's height (lib/biomechanics/flexionView.ts): a little
    // coarser near overhead, but patients can watch the screen. The
    // physio picks with camera_position; side on unless they chose.
    const view: CameraView = p.camera ?? "side";
    return { view, side, posture, coverage: "upper_body", reach: "arm_up_forward" };
  }
  if (ARM_ABDUCTION.includes(metric)) {
    return { view: "front", side, posture, coverage: "upper_body", reach: "arm_up_side" };
  }
  return { view: "front", side, posture, coverage: (p.framing?.requiredCoverage as Coverage) ?? "upper_body", reach: "none" };
}

export function silhouetteFor(setup: PositionSetup): Silhouette {
  if (setup.view === "front" || setup.view === "either") {
    if (setup.coverage === "upper_body") return "front_upper";
    return setup.posture === "seated" ? "front_seated" : "front_standing";
  }
  if (setup.coverage === "upper_body") return "side_upper";
  return setup.posture === "standing" ? "side_standing" : "side_seated";
}

/** The camera-setup line shown before the patient steps in. */
export function setupInstruction(setup: PositionSetup): string {
  const where = setup.posture === "seated" ? "Sit on a chair" : setup.posture === "standing" ? "Stand" : "Sit or stand";
  if (setup.view === "front" || setup.view === "either") return `${where} facing the screen, and fit yourself inside the outline.`;
  const s = setup.side === "right" ? "your right side" : setup.side === "left" ? "your left side" : "one side";
  return `${where} side-on, with ${s} toward the screen, and fit yourself inside the outline.`;
}

// ── One frame ───────────────────────────────────────────────

type P = { x: number; y: number };

const issue = (id: string, say: string, retry: string, arrow: Arrow): PositionIssue => ({ id, say, retry, arrow });

export function assessPosition(
  frame: PoseFrame | null,
  setup: PositionSetup,
  opts: { mirrored?: boolean } = {}
): PositionAssessment {
  const mirrored = opts.mirrored ?? true;
  if (!frame?.personDetected) {
    return { ok: false, body: null, issue: issue("no_person", "Step into view of the camera.", "I can't see you yet. Step in front of the camera.", null) };
  }

  const W = frame.sourceWidth ?? 0;
  const H = frame.sourceHeight ?? 0;
  const A = W > 0 && H > 0 ? W / H : 16 / 9; // frame width in body units
  const lm = frame.landmarks as Record<string, { x: number; y: number; score?: number } | undefined>;
  const score = (k: string) => lm[k]?.score ?? 0;
  const seen = (k: string) => !!lm[k] && score(k) >= POSITION_MIN_SCORE;
  const at = (k: string): P | null => (seen(k) ? { x: lm[k]!.x * A, y: lm[k]!.y } : null);
  const mid = (a: P | null, b: P | null): P | null => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a ?? b);
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

  const lSh = at("left_shoulder"), rSh = at("right_shoulder");
  const lHip = at("left_hip"), rHip = at("right_hip");
  const nose = at("nose");
  const shMid = mid(lSh, rSh);
  const hipMid = mid(lHip, rHip);

  // 1. In view enough to judge anything.
  if (!shMid || (!nose && !hipMid)) {
    return { ok: false, body: null, issue: issue("no_person", "Step into view of the camera.", "I can't see you yet. Step in front of the camera.", null) };
  }

  // Body scale: shoulder-to-hip length, or a guess from the head.
  const torso = hipMid ? dist(shMid, hipMid) : nose ? dist(nose, shMid) * 2.4 : 0.3;

  // Display direction of image-left (raw camera x small).
  const towardLowX: Arrow = mirrored ? "right" : "left"; // where raw-low-x appears on screen
  const towardHighX: Arrow = mirrored ? "left" : "right";

  // 2. Facing the right way.
  const shoulderSpan = lSh && rSh ? Math.abs(lSh.x - rSh.x) : 0;
  const widthRatio = torso > 0 ? shoulderSpan / torso : 0; // ~0.7-0.9 facing, <0.3 side on
  const facingFront = !!(lSh && rSh) && widthRatio > 0.5;
  const sideOn = !(lSh && rSh) || widthRatio < 0.35;

  if (setup.view === "front" && !facingFront) {
    return { ok: false, body: null, issue: issue("face_front", "Turn to face the screen.", "Turn so your whole front faces the screen.", "turn") };
  }
  // Either way round: half turned is the one view that can't be measured.
  if (setup.view === "either" && !facingFront && !sideOn) {
    return { ok: false, body: null, issue: issue("face_front", "Turn to face the screen.", "Turn so your whole front faces the screen.", "turn") };
  }
  if (setup.view === "side" || (setup.view === "either" && sideOn)) {
    const which = setup.side === "right" ? "right" : setup.side === "left" ? "left" : null;
    if (!sideOn) {
      const say = which ? `Turn sideways, so your ${which} side faces the screen.` : "Turn sideways to the screen.";
      return { ok: false, body: null, issue: issue("turn_side", say, say, "turn") };
    }
    if (which) {
      // The side nearer the camera is the one BlazePose sees best.
      const near = (s: string) => score(`${s}_shoulder`) + score(`${s}_elbow`) + score(`${s}_hip`) + score(`${s}_knee`);
      const other = which === "right" ? "left" : "right";
      if (near(other) > near(which) + 0.45) {
        const say = `Turn around, so your ${which} side faces the screen.`;
        return { ok: false, body: null, issue: issue("wrong_side", say, say, "turn") };
      }
    }
  }

  // Which way the patient faces in a side view (+1 = raw +x).
  const facingSign = nose && shMid ? Math.sign(nose.x - shMid.x) || 1 : 1;

  // Arm and leg lengths from what is seen, else from the torso.
  const armOf = (s: string): number | null => {
    const sh = at(`${s}_shoulder`), el = at(`${s}_elbow`), wr = at(`${s}_wrist`);
    return sh && el && wr ? dist(sh, el) + dist(el, wr) : null;
  };
  const arm = Math.max(armOf("left") ?? 0, armOf("right") ?? 0) || torso * 1.15;
  const shinOf = (s: string): number | null => {
    const kn = at(`${s}_knee`), an = at(`${s}_ankle`);
    return kn && an ? dist(kn, an) : null;
  };
  const shin = Math.max(shinOf("left") ?? 0, shinOf("right") ?? 0) || torso * 0.9;

  // 3. Top to bottom, with room for the movement.
  const headTop = (nose ? nose.y : shMid.y - torso * 0.45) - torso * 0.3;
  let needTop = headTop;
  if (setup.reach === "arm_up_forward" || setup.reach === "arm_up_side") needTop = Math.min(headTop, shMid.y - arm);
  if (setup.reach === "stand_up") needTop = headTop - torso * 0.75;

  const lowest = (names: string[]): number | null => {
    const ys = names.map((n) => at(n)?.y).filter((v): v is number => typeof v === "number");
    return ys.length ? Math.max(...ys) : null;
  };
  let needBottom: number;
  let bottomMissing = false;
  if (setup.coverage === "upper_body") {
    const hy = lowest(["left_hip", "right_hip"]);
    needBottom = hy ?? shMid.y + torso;
    bottomMissing = hy === null;
  } else {
    const ay = lowest(["left_ankle", "right_ankle"]);
    // Need the feet: if they are not seen, they are off the bottom.
    needBottom = ay ?? 1.06;
    bottomMissing = ay === null;
  }

  const M = 0.03;
  const span = needBottom - needTop;
  const topOut = needTop < M;
  const bottomOut = needBottom > 1 - M || bottomMissing;
  const feetWord = setup.coverage === "upper_body" ? "your hips" : "your feet";

  if (span > 1 - 2 * M || (topOut && bottomOut)) {
    const room = setup.reach === "stand_up" ? "room to stand up" : setup.reach.startsWith("arm") ? "your arms above your head" : feetWord;
    return {
      ok: false, body: null,
      issue: issue("too_close", `Move further from the camera, so I can see ${room}.`, "A little further back from the camera, please.", "back"),
    };
  }
  if (topOut) {
    const what = setup.reach.startsWith("arm") ? "your raised arms" : setup.reach === "stand_up" ? "your head when you stand" : "your head";
    return { ok: false, body: null, issue: issue("tilt_up", `Tilt the camera up a little, so I can see ${what}.`, "Tilt the camera up a little more.", "tilt_up") };
  }
  if (bottomOut) {
    return { ok: false, body: null, issue: issue("tilt_down", `Tilt the camera down a little, so I can see ${feetWord}.`, "Tilt the camera down a little more.", "tilt_down") };
  }

  // 4. Not too far: the needed span (body plus the movement's reach)
  // should fill a fair part of the frame. Below this the joints get too
  // small for steady tracking (a torso of roughly 1/7 of the frame).
  const minSpan = setup.coverage === "upper_body" ? 0.35 : 0.45;
  if (span < minSpan) {
    return { ok: false, body: null, issue: issue("too_far", "Come a little closer to the camera.", "A little closer to the camera, please.", "closer") };
  }

  // 5. Left and right: the body, plus where the movement reaches.
  const xs: number[] = [shMid.x];
  for (const k of ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "nose", "left_knee", "right_knee", "left_ankle", "right_ankle"]) {
    const p = at(k);
    if (p) xs.push(p.x);
  }
  let needLeft = Math.min(...xs);
  let needRight = Math.max(...xs);
  if (setup.reach === "arm_up_side") {
    const lsx = lSh?.x ?? shMid.x, rsx = rSh?.x ?? shMid.x;
    if (setup.side !== "left") needLeft = Math.min(needLeft, Math.min(lsx, rsx) - arm);    // patient's right arm: image-left
    if (setup.side !== "right") needRight = Math.max(needRight, Math.max(lsx, rsx) + arm); // patient's left arm: image-right
  }
  if (setup.reach === "arm_up_forward" && sideOn) {
    // Side on the raised arm reaches out in front; facing the camera it
    // comes toward the lens and needs no room to the side.
    if (facingSign > 0) needRight = Math.max(needRight, shMid.x + arm);
    else needLeft = Math.min(needLeft, shMid.x - arm);
  }
  if (setup.reach === "leg_forward") {
    const kx = mid(at("left_knee"), at("right_knee"))?.x ?? shMid.x;
    if (facingSign > 0) needRight = Math.max(needRight, kx + shin);
    else needLeft = Math.min(needLeft, kx - shin);
  }

  const leftOut = needLeft < M * A;
  const rightOut = needRight > A * (1 - M);
  const cx = (needLeft + needRight) / 2;

  if ((leftOut && rightOut) || needRight - needLeft > A * (1 - 2 * M)) {
    return { ok: false, body: null, issue: issue("too_close_wide", "Move further from the camera, so your arms fit when you lift them.", "A little further back from the camera, please.", "back") };
  }
  // Off-centre by more than a fifth of the frame, or about to leave an edge.
  if (leftOut || rightOut || Math.abs(cx - A / 2) > A * 0.2) {
    const needHigherX = leftOut || (!rightOut && cx < A / 2);
    // Front view: say it in the patient's own terms. Facing the camera,
    // raw image-left is the patient's RIGHT, so to move to higher x they
    // step to their LEFT. Side view: say it in screen terms.
    const arrow = needHigherX ? towardHighX : towardLowX;
    if (setup.view === "front" || (setup.view === "either" && facingFront)) {
      const dir = needHigherX ? "left" : "right";
      return { ok: false, body: null, issue: issue(`move_${dir}`, `Take a small step to your ${dir}.`, `A little more to your ${dir}.`, arrow) };
    }
    const scr = arrow === "left" ? "left" : "right";
    return { ok: false, body: null, issue: issue(`shift_${scr}`, `Move a little toward the ${scr} side of the screen.`, `A little more toward the ${scr}.`, arrow) };
  }

  // 6. Seated / standing.
  const f = extractMovementFeatures(frame);
  if (setup.posture === "seated" && f.isStanding) {
    return { ok: false, body: null, issue: issue("sit_down", "Please sit down on your chair.", "Sit down on the chair before we start.", "sit") };
  }
  if (setup.posture === "standing" && f.isSeated) {
    return { ok: false, body: null, issue: issue("stand_up", "Please stand up.", "Stand up tall before we start.", "stand") };
  }

  return { ok: true, issue: null, body: { cx: cx / A, top: needTop, bottom: needBottom } };
}

// ── Over time ───────────────────────────────────────────────

export const ISSUE_SETTLE_MS = 500;   // a new instruction must last this long to show
export const LOCK_STILL_MS = 1500;    // good + still this long to lock in
export const UNLOCK_AFTER_MS = 3000;  // once locked, a real problem must last this long

// Once locked in, these no longer interrupt the exercise: drifting a little
// off centre, or a little nearer or further, doesn't stop the camera from
// measuring. (They used to unlock after 1.2 s, so the slightest shift
// stopped the exercise and brought the guide back.) Only real problems
// (out of view, turned the wrong way, cut off by the frame, wrong posture)
// unlock, and only after UNLOCK_AFTER_MS.
export const TOLERATED_WHEN_LOCKED = new Set([
  "move_left", "move_right", "shift_left", "shift_right", "too_far", "hold_still",
]);

export type PositionState = "adjusting" | "hold_still" | "locked";

export type TrackedPosition = {
  state: PositionState;
  issue: PositionIssue | null;  // the steady instruction (null when good)
  progress: number;             // 0..1 toward locking in
};

const HOLD_STILL: PositionIssue = {
  id: "hold_still",
  say: "That's it. Hold still for a moment.",
  retry: "Hold still for a moment.",
  arrow: null,
};

export class PositionTracker {
  private shown: PositionIssue | null = null;
  private candidate: PositionIssue | null = null;
  private candidateSince = 0;
  private okSince: number | null = null;
  private anchor: PositionAssessment["body"] = null;
  private locked = false;
  private badSince: number | null = null;

  reset(): void {
    this.shown = null;
    this.candidate = null;
    this.okSince = null;
    this.anchor = null;
    this.locked = false;
    this.badSince = null;
  }

  isLocked(): boolean {
    return this.locked;
  }

  update(a: PositionAssessment, nowMs: number): TrackedPosition {
    if (this.locked) {
      if (a.ok || (a.issue && TOLERATED_WHEN_LOCKED.has(a.issue.id))) {
        this.badSince = null;
        return { state: "locked", issue: null, progress: 1 };
      }
      this.badSince ??= nowMs;
      if (nowMs - this.badSince < UNLOCK_AFTER_MS) return { state: "locked", issue: null, progress: 1 };
      this.locked = false;
      this.okSince = null;
      this.shown = a.issue;
      this.candidate = a.issue;
      this.candidateSince = nowMs;
      return { state: "adjusting", issue: this.shown, progress: 0 };
    }

    if (!a.ok) {
      this.okSince = null;
      this.anchor = null;
      // Debounce: switch to a different instruction only once it has lasted.
      if (!this.candidate || this.candidate.id !== a.issue?.id) {
        this.candidate = a.issue;
        this.candidateSince = nowMs;
      }
      if (!this.shown || this.shown.id === HOLD_STILL.id || nowMs - this.candidateSince >= ISSUE_SETTLE_MS) {
        this.shown = this.candidate;
      }
      return { state: "adjusting", issue: this.shown, progress: 0 };
    }

    // Good this frame: must stay good and still.
    const moved =
      this.anchor && a.body &&
      (Math.abs(a.body.cx - this.anchor.cx) > 0.04 ||
        Math.abs(a.body.top - this.anchor.top) > 0.04 ||
        Math.abs(a.body.bottom - this.anchor.bottom) > 0.04);
    if (this.okSince === null || moved) {
      this.okSince = nowMs;
      this.anchor = a.body;
    }
    this.candidate = null;
    this.shown = HOLD_STILL;
    const progress = Math.min(1, (nowMs - this.okSince) / LOCK_STILL_MS);
    if (progress >= 1) {
      this.locked = true;
      this.shown = null;
      return { state: "locked", issue: null, progress: 1 };
    }
    return { state: "hold_still", issue: HOLD_STILL, progress };
  }
}
