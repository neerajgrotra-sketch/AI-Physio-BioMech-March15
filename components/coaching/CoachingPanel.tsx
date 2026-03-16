type Props = {
  title: string;
  message: string;
};

export default function CoachingPanel({ title, message }: Props) {
  return (
    <section
      style={{
        background: "#1a2040",
        padding: 20,
        borderRadius: 12
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p style={{ marginBottom: 0, lineHeight: 1.5 }}>{message}</p>
    </section>
  );
}
