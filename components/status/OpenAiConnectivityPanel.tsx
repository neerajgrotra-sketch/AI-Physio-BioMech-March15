"use client";

import { useState } from "react";

type ConnectivityResult = {
  ok: boolean;
  status: number | null;
  model: string;
  body: string;
};

export default function OpenAiConnectivityPanel() {
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<ConnectivityResult | null>(null);

  async function checkConnectivity() {
    try {
      setIsChecking(true);

      const response = await fetch("/api/test-openai", {
        method: "GET",
        cache: "no-store"
      });

      const json = (await response.json()) as ConnectivityResult;
      setResult(json);
    } catch (error) {
      setResult({
        ok: false,
        status: null,
        model: "gpt-4o-mini",
        body: error instanceof Error ? error.message : "Unknown connectivity error"
      });
    } finally {
      setIsChecking(false);
    }
  }

  const badgeBackground = result
    ? result.ok
      ? "rgba(155,231,176,0.14)"
      : "rgba(255,143,143,0.14)"
    : "rgba(255,255,255,0.08)";

  const badgeColor = result
    ? result.ok
      ? "#9be7b0"
      : "#ff8f8f"
    : "white";

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: "#121933",
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>OpenAI Connectivity</div>
          <div style={{ color: "#aab6d3", fontSize: 13, marginTop: 4 }}>
            Check whether the app can reach the OpenAI API right now.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              background: badgeBackground,
              color: badgeColor,
              fontSize: 12,
              fontWeight: 700
            }}
          >
            {result ? (result.ok ? "Connected" : "Not connected") : "Not checked"}
          </span>

          <button
            onClick={checkConnectivity}
            disabled={isChecking}
            style={{
              background: "#7cc6ff",
              color: "#08111f",
              fontWeight: 700,
              padding: "8px 12px",
              borderRadius: 10,
              border: "none",
              cursor: isChecking ? "not-allowed" : "pointer",
              opacity: isChecking ? 0.6 : 1
            }}
          >
            {isChecking ? "Checking..." : "Test OpenAI"}
          </button>
        </div>
      </div>

      {result && (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 8,
            fontSize: 14
          }}
        >
          <div>
            Status: <strong>{result.status ?? "—"}</strong>
          </div>
          <div>
            Model: <strong>{result.model}</strong>
          </div>
          <div>
            Response:
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "rgba(255,255,255,0.04)",
              padding: 10,
              borderRadius: 8,
              color: "white"
            }}
          >
            {result.body}
          </pre>
        </div>
      )}
    </div>
  );
}
