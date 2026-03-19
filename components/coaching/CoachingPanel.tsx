type Props = {
  title: string;
  message: string;
  phase?: string;
  repCount?: number;
  repTarget?: number;
};

function formatPhase(phase?: string) {
  if (!phase) return "Ready";
  if (phase === "lifting") return "Lift";
  if (phase === "holding") return "Hold";
  if (phase === "lowering") return "Lower";
  if (phase === "ready") return "Ready";
  if (phase === "complete") return "Complete";
  return phase;
}

export default function CoachingPanel({
  title,
  message,
  phase,
  repCount,
  repTarget
}: Props) {
  return (
    <section
      style={{
        background: "#1a2040",
        padding: 20,
        borderRadius: 12
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap"
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(124,198,255,0.12)",
              color: "#7cc6ff",
              fontSize: 12
            }}
          >
            {formatPhase(phase)}
          </span>

          {typeof repCount === "number" && typeof repTarget === "number" && (
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                color: "white",
                fontSize: 12
              }}
            >
              {repCount}/{repTarget} reps
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          marginBottom: 0,
          lineHeight: 1.5,
          fontSize: 24,
          fontWeight: 600
        }}
      >
        {message}
      </p>
    </section>
  );
}
