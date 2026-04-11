export default function UnauthorizedPage() {
  return (
    <main style={{
      minHeight: '100vh', background: '#0d1117',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'monospace', color: '#e6edf3',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⛔</div>
        <h1 style={{ marginBottom: 8 }}>Access denied</h1>
        <p style={{ color: '#7d8590', marginBottom: 24 }}>
          You don't have permission to view this page.
        </p>
        <a href="/login" style={{ color: '#388bfd', textDecoration: 'none' }}>
          Return to login →
        </a>
      </div>
    </main>
  )
}
