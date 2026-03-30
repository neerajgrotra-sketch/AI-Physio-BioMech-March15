'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const C = {
  bg: '#0d1117', surface: '#161b22', surfaceHover: '#1c2230',
  border: '#21262d', borderFocus: '#388bfd',
  text: '#e6edf3', textMuted: '#7d8590',
  blue: '#388bfd',
  red: '#f85149', redDim: 'rgba(248,81,73,0.12)',
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
        data: {
          role: 'physio',
          full_name: fullName.trim(),
          clinic_id: '00000000-0000-0000-0000-000000000001',
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
    width: '100%', padding: '10px 14px', borderRadius: 6,
    border: `1px solid ${C.border}`, background: C.bg,
    color: C.text, fontSize: 14, outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    display: 'block', fontSize: 12, color: C.textMuted,
    marginBottom: 6, fontWeight: 500,
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: 12, padding: 32,
      }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>AI Physio BioMech</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: C.text }}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </div>
        </div>

        <div style={{ display: 'flex', background: C.bg, borderRadius: 8, padding: 3, marginBottom: 24, gap: 3 }}>
          {(['signin', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null) }} style={{
              flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
              background: mode === m ? C.surface : 'transparent',
              color: mode === m ? C.text : C.textMuted,
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>
              {m === 'signin' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>Full name</label>
              <input style={inputStyle} type="text" value={fullName}
                onChange={e => setFullName(e.target.value)} placeholder="Dr. Jane Smith" />
            </div>
          )}
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@clinic.com" />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input style={inputStyle} type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 characters' : ''} />
          </div>
        </div>

        {error && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 6,
            background: C.redDim, border: `1px solid ${C.red}`,
            color: C.red, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={mode === 'signin' ? handleSignIn : handleRegister}
          disabled={loading || !email || !password}
          style={{
            width: '100%', marginTop: 24, padding: '11px 0',
            borderRadius: 6, border: 'none',
            background: loading || !email || !password ? C.surfaceHover : C.blue,
            color: loading || !email || !password ? C.textMuted : '#fff',
            fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
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
