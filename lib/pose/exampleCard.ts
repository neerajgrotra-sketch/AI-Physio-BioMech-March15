// ============================================================
// lib/pose/exampleCard.ts
// ============================================================
// The guide figure ("the physio"): a small 3D figure in a corner of the
// camera view that demonstrates the movement and, during the patient's
// rep, mirrors their arm against the target. The owner's plan:
//   - seen from any angle (`yawDeg`): side on (90), three-quarter (35, the
//     default: shows both "forward" and "how high"), or facing (0, used to
//     show "in front of you, not out to the side");
//   - seated on a chair or standing, like the patient;
//   - the same arm as the exercise, the other arm resting like theirs.
// It is drawn as a mirror image (the patient's right arm on the screen's
// right), like the camera preview, so it reads like a reflection.
// Draw only; no state. Body proportions in units of torso length.
// ============================================================

export type ExampleCardParams = {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** The moving arm's elevation, from straight down (0) to overhead (180). */
  armDeg: number;
  targetDeg: number;
  seated: boolean;
  /** Which arm moves (both for bilateral). */
  side: "right" | "left" | "both";
  /** 0 = facing, 35 = three-quarter, 90 = side on. */
  yawDeg: number;
  caption: string;
  rgb: { r: number; g: number; b: number };
  corner?: "bottom-left" | "bottom-right";
};

type P3 = { x: number; y: number; z: number }; // x: patient's right (mirrored: screen right), y: down, z: forward

const rad = (d: number) => (d * Math.PI) / 180;

export function drawExampleCard(p: ExampleCardParams): void {
  const { ctx, W, H, armDeg, targetDeg, seated, side, caption, rgb } = p;
  const cw = Math.round(W * 0.25), ch = Math.round(H * 0.44);
  const pad = 10;
  const x0 = p.corner === "bottom-right" ? W - cw - pad : pad;
  const y0 = H - ch - pad;
  const col = (a: number) => `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;

  // Turn so the moving arm is on the near side when seen side on.
  const turn = side === "left" ? 1 : -1;
  const yaw = rad(p.yawDeg) * turn;
  const u = ch / 4.9;                                   // pixels per torso length
  const cx = x0 + cw / 2, topY = y0 + ch * 0.12;
  // Offsets that centre the figure in the card (set below, once its extent
  // is known: a seated figure is shorter and used to sit at the top).
  let ox = 0, oy = 0;
  const project = (q: P3) => ({
    x: cx + ox + (q.x * Math.cos(yaw) + q.z * Math.sin(yaw)) * u,
    y: topY + oy + q.y * u,
    depth: -q.x * Math.sin(yaw) + q.z * Math.cos(yaw),  // larger = nearer the viewer
  });

  // ── The body (torso length 1) ─────────────────────────────
  const shY = 0.55, hipY = shY + 1;
  const sh = { r: { x: 0.36, y: shY, z: 0 }, l: { x: -0.36, y: shY, z: 0 } };
  const hip = { r: { x: 0.2, y: hipY, z: 0 }, l: { x: -0.2, y: hipY, z: 0 } };
  const head: P3 = { x: 0, y: 0.15, z: 0.02 };
  const upper = 0.58, fore = 0.52, thigh = 0.75, shin = 0.75;
  const armPts = (s: P3, elev: number, restOnLap: boolean) => {
    const e = rad(elev);
    const el = { x: s.x, y: s.y + Math.cos(e) * upper, z: s.z + Math.sin(e) * upper };
    if (restOnLap) return { el, wr: { x: el.x * 0.8, y: el.y + 0.05, z: el.z + fore } }; // forearm along the thigh
    return { el, wr: { x: el.x, y: el.y + Math.cos(e) * fore, z: el.z + Math.sin(e) * fore } };
  };
  const moving = (k: "r" | "l") => side === "both" || (side === "right" ? k === "r" : k === "l");
  const restDeg = seated ? 25 : 4;
  const arms = (["r", "l"] as const).map((k) =>
    moving(k) ? { k, ...armPts(sh[k], armDeg, false), moving: true } : { k, ...armPts(sh[k], restDeg, seated), moving: false }
  );
  const legs = (["r", "l"] as const).map((k) => {
    const h = hip[k];
    const knee = seated ? { x: h.x, y: h.y, z: thigh } : { x: h.x, y: h.y + thigh, z: 0 };
    const ankle = { x: knee.x, y: knee.y + shin, z: knee.z };
    return { h, knee, ankle };
  });

  // Segments to draw, sorted far to near.
  type Seg = { a: P3; b: P3; w: number; style: "body" | "move" | "chair" };
  const segs: Seg[] = [];
  const mid = (a: P3, b: P3): P3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  if (seated) {
    const seatY = hipY + 0.08;
    const c = [[-0.35, 0.85], [0.35, 0.85], [0.35, -0.1], [-0.35, -0.1]].map(([x, z]) => ({ x, y: seatY, z }));
    for (let i = 0; i < 4; i++) segs.push({ a: c[i], b: c[(i + 1) % 4], w: 0.05, style: "chair" });
    for (const q of c) segs.push({ a: q, b: { ...q, y: seatY + 0.8 }, w: 0.05, style: "chair" });
    segs.push({ a: { x: -0.35, y: seatY, z: -0.1 }, b: { x: -0.35, y: seatY - 1.0, z: -0.15 }, w: 0.05, style: "chair" });
    segs.push({ a: { x: 0.35, y: seatY, z: -0.1 }, b: { x: 0.35, y: seatY - 1.0, z: -0.15 }, w: 0.05, style: "chair" });
    segs.push({ a: { x: -0.35, y: seatY - 1.0, z: -0.15 }, b: { x: 0.35, y: seatY - 1.0, z: -0.15 }, w: 0.05, style: "chair" });
  }
  segs.push({ a: mid(sh.r, sh.l), b: mid(hip.r, hip.l), w: 0.5, style: "body" });   // torso
  segs.push({ a: sh.r, b: sh.l, w: 0.14, style: "body" });
  segs.push({ a: hip.r, b: hip.l, w: 0.14, style: "body" });
  for (const L of legs) {
    segs.push({ a: L.h, b: L.knee, w: 0.17, style: "body" });
    segs.push({ a: L.knee, b: L.ankle, w: 0.15, style: "body" });
  }
  for (const a of arms) {
    const s = sh[a.k];
    segs.push({ a: s, b: a.el, w: 0.14, style: a.moving ? "move" : "body" });
    segs.push({ a: a.el, b: a.wr, w: 0.12, style: a.moving ? "move" : "body" });
  }

  // Centre the figure (body and chair, raised arm included) between the
  // title and the caption.
  {
    const pts = segs.flatMap((sg) => [project(sg.a), project(sg.b)]).concat([project({ ...head, y: head.y - 0.3 })]);
    const minX = Math.min(...pts.map((q) => q.x)), maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y)), maxY = Math.max(...pts.map((q) => q.y));
    const areaTop = y0 + 26, areaBottom = y0 + ch - 26;
    oy = (areaTop + areaBottom) / 2 - (minY + maxY) / 2;
    ox = (x0 + cw / 2) - (minX + maxX) / 2;
  }

  ctx.save();
  // Card.
  ctx.fillStyle = "rgba(10,14,30,0.8)";
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(x0, y0, cw, ch, 12) : ctx.rect(x0, y0, cw, ch);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, cw, ch); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("YOUR GUIDE", x0 + 10, y0 + 18);

  // Target: dashed line from the moving shoulder at the target angle (forward).
  const reached = armDeg >= targetDeg - 1;
  for (const a of arms.filter((x) => x.moving)) {
    const s = sh[a.k];
    const e = rad(targetDeg), len = (upper + fore) * 1.08;
    const tgt = { x: s.x, y: s.y + Math.cos(e) * len, z: s.z + Math.sin(e) * len };
    const ps = project(s), pt = project(tgt);
    ctx.setLineDash([u * 0.12, u * 0.1]);
    ctx.strokeStyle = col(0.8);
    ctx.lineWidth = Math.max(1.5, u * 0.05);
    ctx.beginPath(); ctx.moveTo(ps.x, ps.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Body, far to near.
  const drawn = segs
    .map((sg) => ({ sg, d: (project(sg.a).depth + project(sg.b).depth) / 2 }))
    .sort((m, n) => m.d - n.d);
  const headP = project(head);
  let headDrawn = false;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const { sg, d } of drawn) {
    if (!headDrawn && d > headP.depth) {
      drawHead(); headDrawn = true;
    }
    const a = project(sg.a), b = project(sg.b);
    const far = d < -0.1;
    ctx.strokeStyle =
      sg.style === "chair" ? "rgba(235,240,255,0.22)"
      : sg.style === "move" ? (reached ? "rgba(63,185,80,1)" : col(1))
      : far ? "rgba(200,210,235,0.55)" : "rgba(235,240,255,0.92)";
    ctx.lineWidth = Math.max(1.5, sg.w * u);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  if (!headDrawn) drawHead();
  function drawHead() {
    ctx.fillStyle = "rgba(235,240,255,0.95)";
    ctx.beginPath(); ctx.arc(headP.x, headP.y, u * 0.27, 0, Math.PI * 2); ctx.fill();
    // A nose, so you can see which way the figure faces.
    const nose = project({ x: 0, y: head.y + 0.02, z: 0.3 });
    ctx.strokeStyle = "rgba(235,240,255,0.95)";
    ctx.lineWidth = Math.max(1.5, u * 0.08);
    ctx.beginPath(); ctx.moveTo(headP.x, headP.y); ctx.lineTo(nose.x, nose.y); ctx.stroke();
  }
  ctx.restore();

  // Caption.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(caption, x0 + cw / 2, y0 + ch - 10);
  ctx.restore();
}
