// ============================================================
// lib/coaching/demoNarrator.ts
// ============================================================
// The physio talking while they demonstrate (the owner's plan: the guide
// figure is the physio). Each line is tied to a moment of the figure's
// demonstration (lib/pose/ghostAnimator.ts demoCycle: rise 0-2 s, pause at
// the target 2-3.2 s, lower 3.2-5.2 s, pause), so "up to here" is said
// when the figure gets there. The first showing is narrated in full; a
// repeat after a long pause gets a shorter version. Pure: feed it the demo
// clock each frame, it returns at most one line, each once per showing.
// Tested by demoNarrator.test.ts.
// ============================================================

type Line = { at: number; text: string };

export const FIRST_DEMO: Line[] = [
  { at: 0.1, text: "Watch me first." },
  { at: 0.9, text: "Arm straight, and lift it forward." },
  { at: 2.0, text: "Up to here. Hold." },
  { at: 3.3, text: "And slowly down." },
  { at: 5.3, text: "Your turn." },
];

export const REPEAT_DEMO: Line[] = [
  { at: 0.3, text: "Like this. Arm straight, forward and up." },
  { at: 3.3, text: "And down." },
  { at: 5.3, text: "Now you." },
];

// A line more than this late (the voice was busy) is skipped rather than
// said out of step with the figure.
export const MAX_LATE_S = 0.9;

export class DemoNarrator {
  private cycle = -1;
  private next = 0;

  reset(): void {
    this.cycle = -1;
    this.next = 0;
  }

  /**
   * `clock`: the demo clock (null while the figure waits); `busy`: the voice
   * is speaking. Returns the line to say now, or null.
   */
  update(clock: { cycle: number; t: number } | null, busy: boolean): string | null {
    if (!clock) return null;
    if (clock.cycle !== this.cycle) {
      this.cycle = clock.cycle;
      this.next = 0;
    }
    const lines = clock.cycle === 0 ? FIRST_DEMO : REPEAT_DEMO;
    // Skip lines we're too late for.
    while (this.next < lines.length && clock.t - lines[this.next].at > MAX_LATE_S) this.next++;
    const line = lines[this.next];
    if (!line || clock.t < line.at || busy) return null;
    this.next++;
    return line.text;
  }
}
