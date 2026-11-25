import { BRAND, BrandLogo } from '@/components/brand/brand'

export default function UnauthorizedPage() {
  return (
    <main style={{
      minHeight: '100vh', background: BRAND.off,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28,
      fontFamily: BRAND.fontBody, color: BRAND.ink, padding: 24,
    }}>
      <BrandLogo size={40} href="/" />
      <div style={{
        textAlign: 'center', background: BRAND.white, border: `1px solid ${BRAND.border}`,
        borderRadius: 14, padding: '32px 28px', maxWidth: 400, boxShadow: BRAND.shadow,
      }}>
        <h1 style={{ margin: '0 0 8px', fontFamily: BRAND.fontHead, fontSize: 22 }}>No access to this page</h1>
        <p style={{ color: BRAND.ink3, margin: '0 0 24px', lineHeight: 1.6 }}>
          Your account does not have permission to view this page.
        </p>
        <a href="/login" style={{
          display: 'inline-block', background: BRAND.grad, color: '#fff', textDecoration: 'none',
          fontWeight: 600, padding: '10px 20px', borderRadius: 10, boxShadow: BRAND.glow,
        }}>
          Return to login
        </a>
      </div>
    </main>
  )
}
