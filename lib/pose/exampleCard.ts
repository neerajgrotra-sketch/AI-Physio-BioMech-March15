// ============================================================
// lib/pose/exampleCard.ts
// ============================================================
// The "Example" card: a small side-view figure in a corner of the camera
// view that demonstrates the movement, in step with the coaching (the
// ghost's ghostT: demo, rise to the target, hold, lower, invite the next
// rep). Facing the camera a forward raise can't be shown over the
// patient's own body (it comes toward the lens), so the card shows it the
// way an exercise sheet does: side on, with the target angle marked.
// The owner's request (a ghost painted over the patient looked odd).
// Draw only; no state.
// ============================================================

export type ExampleCardParams = {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** The arm's angle now, from straight down (0) to overhead (180). */
  armDeg: number;
  /** The target angle, marked with a dashed line. */
  targetDeg: number;
  /** Seated or standing figure. */
  seated: boolean;
  /** Short caption under the figure, e.g. "Raise to 110°". */
  caption: string;
  /** Highlight colour of the moving arm and the target. */
  rgb: { r: number; g: number; b: number };
  /** Where the card goes. */
  corner?: "bottom-left" | "bottom-right";
};

const rad = (d: number) => (d * Math.PI) / 180;

export function drawExampleCard(p: ExampleCardParams): void {
  const { ctx, W, H, armDeg, targetDeg, seated, caption, rgb } = p;
  const cw = Math.round(W * 0.25), ch = Math.round(H * 0.44);
  const pad = 10;
  const x0 = p.corner === "bottom-right" ? W - cw - pad : pad;
  const y0 = H - ch - pad;
  const col = (a: number) => `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;

  ctx.save();
  // Card.
  ctx.fillStyle = "rgba(10,14,30,0.78)";
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(x0, y0, cw, ch, 12) : ctx.rect(x0, y0, cw, ch);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("EXAMPLE", x0 + 10, y0 + 18);

  // Figure, facing right, sized to the card.
  const u = ch / 10;                      // one unit
  const fx = x0 + cw * 0.42;              // body line
  const headY = y0 + u * 2.3;
  const shY = headY + u * 1.25;           // shoulder
  const hipY = shY + u * 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(235,240,255,0.9)";
  ctx.lineWidth = u * 0.45;
  // Head.
  ctx.beginPath(); ctx.arc(fx, headY, u * 0.62, 0, Math.PI * 2); ctx.stroke();
  // Torso.
  ctx.beginPath(); ctx.moveTo(fx, shY); ctx.lineTo(fx, hipY); ctx.stroke();
  // Legs.
  ctx.beginPath();
  if (seated) {
    const kneeX = fx + u * 1.6, footY = hipY + u * 1.7;
    ctx.moveTo(fx, hipY); ctx.lineTo(kneeX, hipY); ctx.lineTo(kneeX, footY); ctx.lineTo(kneeX + u * 0.5, footY);
    // Chair.
    ctx.stroke();
    ctx.strokeStyle = "rgba(235,240,255,0.35)";
    ctx.lineWidth = u * 0.25;
    ctx.beginPath();
    ctx.moveTo(fx - u * 0.5, hipY - u * 1.8); ctx.lineTo(fx - u * 0.5, hipY + u * 0.3);
    ctx.lineTo(fx + u * 1.3, hipY + u * 0.3); ctx.moveTo(fx - u * 0.4, hipY + u * 0.3); ctx.lineTo(fx - u * 0.4, footY);
    ctx.moveTo(fx + u * 1.2, hipY + u * 0.3); ctx.lineTo(fx + u * 1.2, footY);
  } else {
    const footY = hipY + u * 3.0;
    ctx.moveTo(fx, hipY); ctx.lineTo(fx - u * 0.2, footY); ctx.lineTo(fx + u * 0.4, footY);
  }
  ctx.stroke();

  // Target: a dashed line from the shoulder at the target angle, and the arc.
  const armLen = u * 2.6;
  const at = (deg: number, len: number) => ({ x: fx + Math.sin(rad(deg)) * len, y: shY + Math.cos(rad(deg)) * len });
  const tgt = at(targetDeg, armLen * 1.1);
  ctx.setLineDash([u * 0.35, u * 0.3]);
  ctx.strokeStyle = col(0.85);
  ctx.lineWidth = u * 0.18;
  ctx.beginPath(); ctx.moveTo(fx, shY); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = col(0.35);
  ctx.beginPath();
  // Canvas angles: 0 = +x, increasing clockwise; the arm's 0° (down) is +90° there.
  ctx.arc(fx, shY, armLen * 0.55, Math.PI / 2 - rad(targetDeg), Math.PI / 2, false);
  ctx.stroke();

  // The arm, moving.
  const hand = at(armDeg, armLen);
  const reached = armDeg >= targetDeg - 1;
  ctx.strokeStyle = reached ? "rgba(63,185,80,1)" : col(1);
  ctx.lineWidth = u * 0.5;
  ctx.beginPath(); ctx.moveTo(fx, shY); ctx.lineTo(hand.x, hand.y); ctx.stroke();
  ctx.fillStyle = reached ? "rgba(63,185,80,1)" : col(1);
  ctx.beginPath(); ctx.arc(hand.x, hand.y, u * 0.32, 0, Math.PI * 2); ctx.fill();

  // Caption.
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(caption, x0 + cw / 2, y0 + ch - 10);
  ctx.restore();
}
