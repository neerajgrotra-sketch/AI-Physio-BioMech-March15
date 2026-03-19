type Props = {
  title: string;
  message: string;
  phase?: string;
  repCount?: number;
  repTarget?: number;
  exerciseName?: string;
  progressLabel?: string;
  minHeight?: number;
};

function formatPhase(phase?: string) {
  if (!phase) return "Ready";
  if (phase === "lifting") return "Lift";
  if (phase === "holding") return "Hold";
  if (phase === "lowering") return "Lower";
  if (phase === "ready") return "Ready";
  if (phase === "complete") return "Complete";
  return "Tracking";
}

export default function CoachingPanel({
  title,
  message,
  phase,
  repCount,
  repTarget,
  exerciseName,
  progressLabel,
  minHeight = 280
}: Props) {
  return (
    <section
      style={{
        background: "#1a2040",
        padding: 22,
        borderRadius: 14,
        minHeight,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: 14,
            flexWrap: "wrap"
          }}
        >
          <h2 style={{ margin: 0 }}>{title}</h2>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap"
            }}
          >
            <span
              style={{
                padding: "5px 10px",
                borderRadius: 999,
                background: "rgba(124,198,255,0.12)",
                color: "#7cc6ff",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              {formatPhase(phase)}
            </span>

            {typeof repCount === "number" && typeof repTarget === "number" && (
              <span
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 700
                }}
              >
                {repCount}/{repTarget} reps
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            fontSize: 30,
            lineHeight: 1.35,
            fontWeight: 700,
            marginTop: 16,
            marginBottom: 18,
            letterSpacing: -0.2
          }}
        >
          {message}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 8,
          fontSize: 14,
          color: "#aab6d3"
        }}
      >
        {exerciseName && (
          <div>
            Current exercise: <strong style={{ color: "white" }}>{exerciseName}</strong>
          </div>
        )}

        {progressLabel && (
          <div>
            Progress: <strong style={{ color: "white" }}>{progressLabel}</strong>
          </div>
        )}
      </div>
    </section>
  );
}
