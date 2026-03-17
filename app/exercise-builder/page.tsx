import ExerciseBuilder from "@/components/exercise/ExerciseBuilder";

export default function ExerciseBuilderPage() {
  return (
    <main style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
      <h1>Exercise Builder</h1>
      <p style={{ color: "#aab6d3" }}>
        Create a prescription from a reusable exercise template.
      </p>

      <ExerciseBuilder />
    </main>
  );
}
