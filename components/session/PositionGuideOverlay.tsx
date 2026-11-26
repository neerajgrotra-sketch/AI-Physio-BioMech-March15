"use client";

// ============================================================
// components/session/PositionGuideOverlay.tsx
// ============================================================
// Draws the positioning coach over the camera view: a silhouette
// of where to be (front / side, seated / standing, upper body or
// whole body), one big instruction with an arrow, and a ring that
// fills while the patient holds still. Amber while adjusting, blue
// while holding still.
//
// The SVG uses the video's own pixel size as its viewBox with
// "slice", which crops exactly like the video's object-fit: cover.
// ============================================================

import type { PositionGuide } from "@/lib/framing/useFramingIntelligence";
import type { Arrow, Silhouette } from "@/lib/positioning/positionCoach";

type J = [number, number]; // a joint in the guide box, 0..1 each way

type Figure = {
  aspect: number;          // box width / height
  top: number;             // box top, fraction of frame height
  bottom: number;          // box bottom
  head: [number, number, number]; // cx, cy, r (r in box heights)
  torso?: J[];             // filled body shape (front views)
  bones: Array<[J, J]>;
  reach?: Array<[J, J]>;   // the movement's peak, drawn dashed
};

// Each figure faces image-right in side views. Coordinates are rough
// body proportions; the box placement leaves room for the movement, and
// whole-body figures start below the instruction banner.
const FIGURES: Record<Silhouette, Figure> = {
  front_upper: {
    aspect: 0.9, top: 0.32, bottom: 0.98, head: [0.5, 0.12, 0.09],
    torso: [[0.27, 0.31], [0.73, 0.31], [0.65, 0.97], [0.35, 0.97]],
    bones: [[[0.47, 0.22], [0.47, 0.3]], [[0.53, 0.22], [0.53, 0.3]],
      [[0.27, 0.33], [0.2, 0.62]], [[0.2, 0.62], [0.18, 0.88]], [[0.73, 0.33], [0.8, 0.62]], [[0.8, 0.62], [0.82, 0.88]]],
    reach: [[[0.27, 0.33], [0.05, -0.35]], [[0.73, 0.33], [0.95, -0.35]]],
  },
  side_upper: {
    aspect: 0.6, top: 0.32, bottom: 0.98, head: [0.5, 0.12, 0.09],
    bones: [[[0.5, 0.3], [0.5, 0.97]], [[0.5, 0.33], [0.53, 0.62]], [[0.53, 0.62], [0.55, 0.88]]],
    reach: [[[0.5, 0.33], [0.95, -0.25]]],
  },
  front_standing: {
    aspect: 0.42, top: 0.27, bottom: 0.97, head: [0.5, 0.06, 0.05],
    torso: [[0.25, 0.18], [0.75, 0.18], [0.66, 0.53], [0.34, 0.53]],
    bones: [[[0.35, 0.52], [0.37, 0.75]], [[0.37, 0.75], [0.38, 0.97]], [[0.65, 0.52], [0.63, 0.75]], [[0.63, 0.75], [0.62, 0.97]],
      [[0.25, 0.19], [0.17, 0.36]], [[0.17, 0.36], [0.15, 0.5]], [[0.75, 0.19], [0.83, 0.36]], [[0.83, 0.36], [0.85, 0.5]]],
  },
  front_seated: {
    aspect: 0.55, top: 0.27, bottom: 0.97, head: [0.5, 0.08, 0.06],
    torso: [[0.27, 0.25], [0.73, 0.25], [0.68, 0.63], [0.32, 0.63]],
    bones: [[[0.33, 0.62], [0.3, 0.68]], [[0.3, 0.68], [0.32, 0.97]], [[0.67, 0.62], [0.7, 0.68]], [[0.7, 0.68], [0.68, 0.97]],
      [[0.27, 0.26], [0.22, 0.45]], [[0.22, 0.45], [0.3, 0.6]], [[0.73, 0.26], [0.78, 0.45]], [[0.78, 0.45], [0.7, 0.6]]],
  },
  side_standing: {
    aspect: 0.3, top: 0.27, bottom: 0.97, head: [0.55, 0.06, 0.05],
    bones: [[[0.5, 0.15], [0.5, 0.52]], [[0.5, 0.52], [0.53, 0.75]], [[0.53, 0.75], [0.5, 0.97]], [[0.5, 0.97], [0.75, 0.97]],
      [[0.5, 0.19], [0.53, 0.36]], [[0.53, 0.36], [0.55, 0.5]]],
  },
  side_seated: {
    aspect: 0.75, top: 0.3, bottom: 0.97, head: [0.3, 0.08, 0.07],
    bones: [[[0.3, 0.17], [0.3, 0.6]], [[0.3, 0.6], [0.72, 0.6]], [[0.72, 0.6], [0.72, 0.97]], [[0.72, 0.97], [0.86, 0.97]],
      [[0.3, 0.25], [0.36, 0.42]], [[0.36, 0.42], [0.5, 0.52]]],
    reach: [[[0.72, 0.6], [1.12, 0.6]]],
  },
};

const ICON: Record<Exclude<Arrow, null>, string> = {
  left: "⬅", right: "➡", back: "↩", closer: "↪", turn: "⟳", tilt_up: "⬆", tilt_down: "⬇", sit: "⬇", stand: "⬆",
};

const COLOR = { adjusting: "#f0b429", hold_still: "#58a6ff", locked: "#3fb950" } as const;

export const POSITION_ICON = ICON;
export const POSITION_COLOR = COLOR;

/**
 * `textInPanel`: the instruction is shown in the coach panel beside the
 * camera (the owner's request: keep the camera clear while the patient
 * places themselves), so the camera shows only the outline, the side arrows,
 * the hold ring and a small arrow badge, no text.
 */
export default function PositionGuideOverlay({ guide, textInPanel = false }: { guide: PositionGuide; textInPanel?: boolean }) {
  const { videoWidth: W, videoHeight: H } = guide;
  const fig = FIGURES[guide.silhouette];
  const boxH = (fig.bottom - fig.top) * H;
  const boxW = boxH * fig.aspect;
  const x0 = W / 2 - boxW / 2;
  const y0 = fig.top * H;
  const pt = ([u, v]: J) => `${x0 + u * boxW},${y0 + v * boxH}`;
  const color = COLOR[guide.state];
  const limb = Math.max(6, boxH * 0.07);
  const arrow = guide.issue?.arrow ?? null;

  const bones = (list: Array<[J, J]>, width: number, stroke: string, dash?: string) =>
    list.map(([a, b], i) => (
      <polyline key={i} points={`${pt(a)} ${pt(b)}`} stroke={stroke} strokeWidth={width}
        strokeLinecap="round" fill="none" strokeDasharray={dash} />
    ));

  // Ring that fills while holding still.
  const ringR = Math.min(W, H) * 0.06;
  const circ = 2 * Math.PI * ringR;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-live="polite">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" width="100%" height="100%"
        style={{ position: "absolute", inset: 0 }}>
        {/* Dark under-stroke so the outline reads on any background */}
        <g opacity={0.55}>
          {fig.torso && <polygon points={fig.torso.map(pt).join(" ")} fill="none" stroke="#000" strokeWidth={limb * 0.5 + 8} strokeLinejoin="round" />}
          {bones(fig.bones, limb + 8, "#000")}
          <circle cx={x0 + fig.head[0] * boxW} cy={y0 + fig.head[1] * boxH} r={fig.head[2] * boxH + 4}
            fill="none" stroke="#000" strokeWidth={limb * 0.5 + 8} />
        </g>
        <g opacity={0.9}>
          {fig.torso && <polygon points={fig.torso.map(pt).join(" ")} fill={color} fillOpacity={0.25}
            stroke={color} strokeWidth={limb * 0.5} strokeLinejoin="round" />}
          {bones(fig.bones, limb, color)}
          <circle cx={x0 + fig.head[0] * boxW} cy={y0 + fig.head[1] * boxH} r={fig.head[2] * boxH}
            fill="none" stroke={color} strokeWidth={limb * 0.5} />
          {fig.reach && bones(fig.reach, limb * 0.5, color, `${limb * 0.6} ${limb * 0.9}`)}
        </g>

        {(arrow === "left" || arrow === "right") && (
          <g fill={color} opacity={0.9}>
            {[0, 1, 2].map((i) => {
              const dir = arrow === "left" ? -1 : 1;
              const cx = W / 2 + dir * (boxW / 2 + W * 0.05 + i * W * 0.035);
              const cy = H * 0.5;
              const s = H * 0.05;
              return <polygon key={i} points={`${cx - dir * s},${cy - s} ${cx + dir * s},${cy} ${cx - dir * s},${cy + s}`}
                opacity={0.4 + i * 0.3} />;
            })}
          </g>
        )}

        {guide.state === "hold_still" && (
          <g transform={`translate(${W / 2 + boxW / 2 + ringR * 1.6}, ${H * 0.45})`}>
            <circle r={ringR} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.25)" strokeWidth={8} />
            <circle r={ringR} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${circ * guide.progress} ${circ}`} transform="rotate(-90)" />
          </g>
        )}
      </svg>

      {/* Direction badge (icon only) when the words are in the coach panel. */}
      {textInPanel && arrow && arrow !== "left" && arrow !== "right" && (
        <div aria-hidden="true" style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          width: 64, height: 64, borderRadius: 32, background: "rgba(8,17,31,0.72)", border: `3px solid ${color}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color,
        }}>{ICON[arrow]}</div>
      )}

      {/* Instruction: HTML so it is never mirrored */}
      {!textInPanel && <div style={{
        position: "absolute", left: 12, right: 12, top: 12, display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px", borderRadius: 14, background: "rgba(8,17,31,0.72)",
        border: `2px solid ${color}`, color: "#fff",
      }}>
        {arrow && <div style={{ fontSize: 34, lineHeight: 1, color }}>{ICON[arrow]}</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "clamp(17px, 2.6vw, 24px)", fontWeight: 700, lineHeight: 1.25 }}>
            {guide.issue?.say ?? "Fit yourself inside the outline."}
          </div>
          <div style={{ fontSize: 13, color: "#c9d1d9", marginTop: 4 }}>{guide.setupLine}</div>
        </div>
      </div>}
    </div>
  );
}
