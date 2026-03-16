import type { MovementFeatures } from "@/lib/types/movement";

type Props = {
  features: MovementFeatures;
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export default function DebugPanel({ features }: Props) {
  const rows = [
    ["posture", features.posture],
    ["rightArmElevationDeg", features.rightArmElevationDeg],
    ["leftArmElevationDeg", features.leftArmElevationDeg],
    ["bilateralArmElevationDeg", features.bilateralArmElevationDeg],
    ["rightElbowAngleDeg", features.rightElbowAngleDeg],
    ["leftElbowAngleDeg", features.leftElbowAngleDeg],
    ["torsoLeanDeg", features.torsoLeanDeg],
    ["shoulderTiltDeg", features.shoulderTiltDeg],
    ["rightWristAboveShoulder", features.rightWristAboveShoulder],
    ["leftWristAboveShoulder", features.leftWristAboveShoulder],
    ["rightWristToShoulderDy", features.rightWristToShoulderDy],
    ["leftWristToShoulderDy", features.leftWristToShoulderDy]
  ];

  return (
    <section
      style={{
        background: "#1a2040",
        padding: 20,
        borderRadius: 12
      }}
    >
      <h3 style={{ marginTop: 0 }}>Debug Panel</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 10,
          fontFamily: "monospace",
          fontSize: 14
        }}
      >
        {rows.map(([label, value]) => (
          <>
            <div key={`${label}-label`} style={{ color: "#aab6d3" }}>
              {label}
            </div>
            <div key={`${label}-value`}>{renderValue(value)}</div>
          </>
        ))}
      </div>
    </section>
  );
}
