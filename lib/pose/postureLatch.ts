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

  constructor(initial: Posture = "seated") {
    this.value = initial;
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
    if (nowMs - this.otherSince >= SWITCH_AFTER_MS) {
      this.value = raw;
      this.otherSince = null;
    }
    return this.value;
  }
}
