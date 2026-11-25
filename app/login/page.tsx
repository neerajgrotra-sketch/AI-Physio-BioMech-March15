'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { BRAND, BrandLogo } from '@/components/brand/brand'

// Light theme matching the landing page (components/brand/brand.tsx).
const C = {
  bg: BRAND.off, surface: BRAND.white, surfaceHover: '#F1F2F8',
  border: BRAND.border, borderFocus: BRAND.violet,
  text: BRAND.ink, textMuted: BRAND.ink3,
  blue: BRAND.violet, blueDim: 'rgba(108,99,255,0.08)',
  purple: '#8B5CF6',
  red: '#DC2626', redDim: 'rgba(220,38,38,0.08)',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/admin'

  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleSignIn = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      window.location.href = redirectTo
    }
  }

  const handleRegister = async () => {
    if (!fullName.trim()) { setError('Full name is required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Only the name is sent. Role and clinic are decided by the
        // database (handle_new_user), never by the browser.
        data: {
          full_name: fullName.trim(),
        }
      }
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      window.location.href = redirectTo
    }
  }

  const inputStyle = {
    width: '100%', padding: '11px 14px', borderRadius: 8,
    border: `1px solid ${C.border}`, background: C.surface,
    color: C.text, fontSize: 14, outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  }

  const labelStyle = {
    display: 'block', fontSize: 12, color: C.textMuted,
    marginBottom: 6, fontWeight: 600,
    letterSpacing: '0.04em', textTransform: 'uppercase' as const,
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: BRAND.fontBody,
      backgroundImage: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(108,99,255,0.08), transparent 70%)',
    }}>

      {/* ── Brand block ── */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <BrandLogo size={44} href="/" />
        </div>

        {/* Tagline */}
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: 'transparent',
          background: BRAND.grad,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
        }}>
          AI-Powered Rehabilitation Intelligence
        </div>
      </div>

      {/* ── Auth card ── */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 32,
        boxShadow: BRAND.shadow,
      }}>

        {/* Card heading */}
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: BRAND.fontHead, letterSpacing: '-0.01em' }}>
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
            {mode === 'signin' ? 'Sign in to your clinic dashboard' : 'Register as a physiotherapist'}
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', background: C.bg, borderRadius: 8,
          padding: 3, marginBottom: 24, gap: 3,
          border: `1px solid ${C.border}`,
        }}>
          {(['signin', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null) }} style={{
              flex: 1, padding: '8px 0', borderRadius: 6, border: 'none',
              background: mode === m ? C.surface : 'transparent',
              color: mode === m ? C.text : C.textMuted,
              fontSize: 13, fontWeight: mode === m ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
              fontFamily: 'inherit',
              boxShadow: mode === m ? '0 1px 3px rgba(15,17,23,0.10)' : 'none',
            }}>
              {m === 'signin' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>Full name</label>
              <input
                style={inputStyle} type="text" value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Dr. Jane Smith"
                onFocus={e => (e.target.style.borderColor = C.borderFocus)}
                onBlur={e => (e.target.style.borderColor = C.border)}
              />
            </div>
          )}
          <div>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle} type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@clinic.com"
              onFocus={e => (e.target.style.borderColor = C.borderFocus)}
              onBlur={e => (e.target.style.borderColor = C.border)}
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle} type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 characters' : ''}
              onFocus={e => (e.target.style.borderColor = C.borderFocus)}
              onBlur={e => (e.target.style.borderColor = C.border)}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 8,
            background: C.redDim, border: `1px solid ${C.red}40`,
            color: C.red, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={mode === 'signin' ? handleSignIn : handleRegister}
          disabled={loading || !email || !password}
          style={{
            width: '100%', marginTop: 24, padding: '12px 0',
            borderRadius: 10, border: 'none',
            background: loading || !email || !password
              ? C.surfaceHover
              : BRAND.grad,
            color: loading || !email || !password ? C.textMuted : '#fff',
            fontSize: 14, fontWeight: 700,
            cursor: loading ? 'wait' : ((!email || !password) ? 'not-allowed' : 'pointer'),
            fontFamily: 'inherit',
            letterSpacing: '0.01em',
            transition: 'opacity 0.15s',
            boxShadow: (!loading && email && password)
              ? BRAND.glow
              : 'none',
          }}
        >
          {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

      </div>

      {/* ── Footer ── */}
      <div style={{
        marginTop: 32, fontSize: 12, color: C.textMuted,
        textAlign: 'center', lineHeight: 1.6,
      }}>
        Rehably is PIPEDA compliant · Data stored in Canada
      </div>

    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
