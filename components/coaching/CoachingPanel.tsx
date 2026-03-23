type Props = {
  title: string;
  message: string;
  secondaryMessage?: string | null;
  phase?: string;
  repCount?: number;
  repTarget?: number;
  exerciseName?: string;
  progressLabel?: string;
  holdSeconds?: number | null;
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
  secondaryMessage,
  phase,
  repCount,
  repTarget,
  exerciseName,
  progressLabel,
  holdSeconds,
  minHeight = 540
}: Props) {
  const showRepBadge =
    typeof repCount === "number" &&
    typeof repTarget === "number" &&
    repTarget > 0;

  const showHoldBadge = typeof holdSeconds === "number" && holdSeconds > 0;
  const showSecondary = Boolean(secondaryMessage?.trim());

  return (
    <section
      style={{
        background: "#1a2040",
        padding: 24,
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
            marginBottom: 18,
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
                padding: "6px 12px",
                borderRadius: 999,
                background: "rgba(124,198,255,0.12)",
                color: "#7cc6ff",
                fontSize: 13,
                fontWeight: 700
              }}
            >
              {formatPhase(phase)}
            </span>

            {showRepBadge && (
              <span
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 700
                }}
              >
                Rep {repCount}/{repTarget}
              </span>
            )}

            {showHoldBadge && (
              <span
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "rgba(155,231,176,0.14)",
                  color: "#9be7b0",
                  fontSize: 13,
                  fontWeight: 700
                }}
              >
                Hold {holdSeconds}s
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            background: "#121933",
            borderRadius: 14,
            padding: "28px 24px",
            minHeight: 240,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            textAlign: "center",
            border: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <div
            style={{
              fontSize: 34,
              lineHeight: 1.35,
              fontWeight: 700,
              letterSpacing: -0.3,
              maxWidth: 580,
              margin: "0 auto"
            }}
          >
            {message}
          </div>

          {showSecondary && (
            <div
              style={{
                marginTop: 18,
                maxWidth: 580,
                marginInline: "auto",
                padding: "10px 14px",
                borderRadius: 12,
                background: "rgba(255,191,71,0.12)",
                color: "#ffd37a",
                fontSize: 15,
                lineHeight: 1.45,
                fontWeight: 500
              }}
            >
              {secondaryMessage}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          marginTop: 22,
          fontSize: 15,
          color: "#aab6d3"
        }}
      >
        {exerciseName && (
          <div>
            Current exercise:{" "}
            <strong style={{ color: "white" }}>{exerciseName}</strong>
          </div>
        )}

        {progressLabel && (
          <div>
            Progress:{" "}
            <strong style={{ color: "white" }}>{progressLabel}</strong>
          </div>
        )}
      </div>
    </section>
  );
}