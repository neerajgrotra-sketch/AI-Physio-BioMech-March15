import type { MovementFeatures } from "@/lib/types/movement";

type AiCoachingDebug = {
  requestedAt: number;
  requestEvent: string;
  requestExercise: string;
  requestIntent: string;
  requestIssues: string[];
  history: {
    lastIssues: string[];
    repeatedIssue?: string;
    repeatedIssueCount: number;
    dominantIssue?: string;
    trend: "improving" | "worsening" | "stable";
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    recentEvents: string[];
  };
  httpOk: boolean | null;
  httpStatus: number | null;
  usedFallback: boolean;
  returnedMessage: string | null;
  promptPreview: string | null;
  model: string | null;
  error: string | null;
};

type Props = {
  runtime: {
    phase: string;
    repCount: number;
    repTarget: number;
    holdSeconds: number | null;
    activeMetricValue: number | null;
    engineStatus: string;
    currentExercise: string;
    overallProgress: string;
    lastEvent: string;
    primaryIssue: string;
    detectedIssues: string[];
    failureReason: string | null;
    aiRequestInFlight: boolean;
  };
  features: MovementFeatures;
  aiDebug: AiCoachingDebug | null;
};

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function prettyList(values: string[]): string {
  if (!values.length) return "—";
  return values.join(", ");
}

export default function AiDebugPanel({ runtime, features, aiDebug }: Props) {
  return (
    <section
      style={{
        background: "#1a2040",
        padding: 20,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 16 }}>Developer Debug</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16
        }}
      >
        <div
          style={{
            background: "#121933",
            borderRadius: 12,
            padding: 14
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Runtime</h3>
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div>Engine: <strong>{runtime.engineStatus}</strong></div>
            <div>Exercise: <strong>{runtime.currentExercise}</strong></div>
            <div>Progress: <strong>{runtime.overallProgress}</strong></div>
            <div>Phase: <strong>{runtime.phase}</strong></div>
            <div>Last event: <strong>{runtime.lastEvent}</strong></div>
            <div>Rep count: <strong>{runtime.repCount}/{runtime.repTarget}</strong></div>
            <div>Hold seconds: <strong>{valueOrDash(runtime.holdSeconds)}</strong></div>
            <div>Active metric: <strong>{valueOrDash(runtime.activeMetricValue)}</strong></div>
            <div>Primary issue: <strong>{runtime.primaryIssue}</strong></div>
            <div>Detected issues: <strong>{prettyList(runtime.detectedIssues)}</strong></div>
            <div>Failure reason: <strong>{valueOrDash(runtime.failureReason)}</strong></div>
            <div>AI in flight: <strong>{runtime.aiRequestInFlight ? "yes" : "no"}</strong></div>
          </div>
        </div>

        <div
          style={{
            background: "#121933",
            borderRadius: 12,
            padding: 14
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Movement Features</h3>
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div>Posture: <strong>{features.posture}</strong></div>
            <div>Standing: <strong>{features.isStanding ? "yes" : "no"}</strong></div>
            <div>Seated: <strong>{features.isSeated ? "yes" : "no"}</strong></div>
            <div>Right arm elevation: <strong>{valueOrDash(features.rightArmElevationDeg)}</strong></div>
            <div>Left arm elevation: <strong>{valueOrDash(features.leftArmElevationDeg)}</strong></div>
            <div>Bilateral elevation: <strong>{valueOrDash(features.bilateralArmElevationDeg)}</strong></div>
            <div>Torso lean: <strong>{valueOrDash(features.torsoLeanDeg)}</strong></div>
            <div>Shoulder tilt: <strong>{valueOrDash(features.shoulderTiltDeg)}</strong></div>
            <div>Right elbow angle: <strong>{valueOrDash(features.rightElbowAngleDeg)}</strong></div>
            <div>Left elbow angle: <strong>{valueOrDash(features.leftElbowAngleDeg)}</strong></div>
            <div>Hip height: <strong>{valueOrDash(features.hipHeightNormalized)}</strong></div>
            <div>Hip velocity Y: <strong>{valueOrDash(features.hipVelocityY)}</strong></div>
          </div>
        </div>

        <div
          style={{
            background: "#121933",
            borderRadius: 12,
            padding: 14
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>AI / OpenAI</h3>

          {aiDebug ? (
            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              <div>Requested at: <strong>{new Date(aiDebug.requestedAt).toLocaleTimeString()}</strong></div>
              <div>Request event: <strong>{aiDebug.requestEvent}</strong></div>
              <div>Request exercise: <strong>{aiDebug.requestExercise}</strong></div>
              <div>Intent: <strong>{aiDebug.requestIntent}</strong></div>
              <div>Request issues: <strong>{prettyList(aiDebug.requestIssues)}</strong></div>
              <div>HTTP ok: <strong>{valueOrDash(aiDebug.httpOk)}</strong></div>
              <div>HTTP status: <strong>{valueOrDash(aiDebug.httpStatus)}</strong></div>
              <div>Used fallback: <strong>{aiDebug.usedFallback ? "yes" : "no"}</strong></div>
              <div>Model: <strong>{valueOrDash(aiDebug.model)}</strong></div>
              <div>Error: <strong>{valueOrDash(aiDebug.error)}</strong></div>

              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 6, fontWeight: 700 }}>Returned message</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "rgba(255,255,255,0.04)",
                    padding: 10,
                    borderRadius: 8
                  }}
                >
                  {valueOrDash(aiDebug.returnedMessage)}
                </pre>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 6, fontWeight: 700 }}>Prompt preview</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "rgba(255,255,255,0.04)",
                    padding: 10,
                    borderRadius: 8,
                    maxHeight: 280,
                    overflow: "auto"
                  }}
                >
                  {valueOrDash(aiDebug.promptPreview)}
                </pre>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 6, fontWeight: 700 }}>History snapshot</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "rgba(255,255,255,0.04)",
                    padding: 10,
                    borderRadius: 8
                  }}
                >
                  {JSON.stringify(aiDebug.history, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ color: "#aab6d3" }}>
              No AI call recorded yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
