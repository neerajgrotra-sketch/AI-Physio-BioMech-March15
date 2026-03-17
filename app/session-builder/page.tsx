import SessionBuilder from "@/components/session/SessionBuilder";

export default function SessionBuilderPage() {
  return (
    <main style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
      <h1>Session Builder</h1>
      <p style={{ color: "#aab6d3" }}>
        Build therapy sessions from your exercise prescription library.
      </p>

      <SessionBuilder />
    </main>
  );
}
