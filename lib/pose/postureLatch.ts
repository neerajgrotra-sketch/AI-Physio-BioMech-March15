// ============================================================
// lib/pose/postureLatch.ts
// ============================================================
// A steady seated / standing for the guide figure. The per-frame posture
// flickers when the legs are half hidden (a desk, the frame's edge), and
// the figure kept flipping between sitting and standing (the owner's
// test). The latch starts from the prescription's posture (or seated),
// ignores "unknown", and only switches once the other posture has been
// seen steadily for SWITCH_AFTER_MS. Pure. Tested by postureLatch.test.ts.
// ============================================================

export type Posture = "seated" | "standing";
export const SWITCH_AFTER_MS = 6000; // was 2500: the guide still stood up and sat down mid-exercise

export class PostureLatch {
  private value: Posture;
  private otherSince: number | null = null;

  private switchMs: number;
  constructor(initial: Posture = "seated", switchMs: number = SWITCH_AFTER_MS) {
    this.value = initial;
    this.switchMs = switchMs;
  }

  reset(initial: Posture): void {
    this.value = initial;
    this.otherSince = null;
  }

  get(): Posture {
    return this.value;
  }

  /** Feed the per-frame reading; returns the steady posture. */
  update(raw: Posture | "unknown", nowMs: number): Posture {
    if (raw === "unknown" || raw === this.value) {
      if (raw === this.value) this.otherSince = null;
      return this.value;
    }
    this.otherSince ??= nowMs;
    if (nowMs - this.otherSince >= this.switchMs) {
      this.value = raw;
      this.otherSince = null;
    }
    return this.value;
  }
}

// ── Standing up when the legs can't be seen ─────────────────────────────
// The owner's run (v0.10.0, left arm): the patient stood up and the guide
// kept sitting. The leg reading needs the knees in the picture, and close
// to a laptop they often aren't. Standing up from a chair lifts the
// shoulders by most of a torso length (sitting down drops them as much);
// raising an arm or leaning barely moves them. So the shoulder height is
// remembered for each posture while the legs say so, and a big move from
// it, held, reads as the other posture.
export const RISE_TORSOS = 0.45; // shoulders this many torso lengths above the seated place = standing

export class RiseDetector {
  private ref: Record<Posture, number | null> = { seated: null, standing: null };

  reset(): void {
    this.ref = { seated: null, standing: null };
  }

  /**
   * The posture to feed the latch: the leg reading when there is one (and it
   * teaches where the shoulders sit for it), else a guess from how far the
   * shoulders have moved from where they were in the latched posture.
   */
  read(raw: Posture | "unknown", latched: Posture, shoulderY: number | null, torso: number | null): Posture | "unknown" {
    if (shoulderY === null || torso === null || torso < 0.05) return raw;
    if (raw !== "unknown") {
      const r = this.ref[raw];
      this.ref[raw] = r === null ? shoulderY : r + (shoulderY - r) * 0.05;
      return raw;
    }
    const r = this.ref[latched];
    if (r === null) {
      // No leg reading for this posture yet (it was itself guessed): start
      // from here, so sitting back down can be seen too.
      this.ref[latched] = shoulderY;
      return raw;
    }
    const rise = (r - shoulderY) / torso; // image y grows downward
    if (latched === "seated" && rise > RISE_TORSOS) return "standing";
    if (latched === "standing" && rise < -RISE_TORSOS) return "seated";
    // Follow slow drift (stepping nearer or further) very slowly: standing up
    // takes a second or two and must still show as a jump.
    this.ref[latched] = r + (shoulderY - r) * 0.005;
    return raw;
  }
}
