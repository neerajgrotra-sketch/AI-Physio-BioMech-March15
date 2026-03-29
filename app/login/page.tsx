'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { Suspense } from 'react'

const C = {
  bg: '#0d1117', surface: '#161b22', surfaceHover: '#1c2230',
  border: '#21262d', borderFocus: '#388bfd',
  text: '#e6edf3', textMuted: '#7d8590', textDim: '#484f58',
  green: '#3fb950', blue: '#388bfd', blueDim: 'rgba(56,139,253,0.12)',
  red: '#f85149', redDim: 'rgba(248,81,73,0.12)',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/admin'

  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const supabase = getSupabaseClient()

  const handleSignIn = async () => {
  setLoading(true)
  setError(null)
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    setError(error.message)
    setLoading(false)
  } else {
    // Hard navigate instead of router.push — forces full page reload
    // so middleware picks up the fresh session cookie
    window.location.href = redirectTo ?? '/admin'
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
      router.push(redirectTo)
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
        {/* Logo / title */}
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>
            AI Physio BioMech
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: C.text }}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', background: C.bg, borderRadius: 8,
          padding: 3, marginBottom: 24, gap: 3,
        }}>
          {(['signin', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null) }} style={{
              flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
              background: mode === m ? C.surface : 'transparent',
              color: mode === m ? C.text : C.textMuted,
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              transition: 'all 0.15s',
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
                onFocus={e => e.target.style.borderColor = C.borderFocus}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle} type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@clinic.com"
              onFocus={e => e.target.style.borderColor = C.borderFocus}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle} type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 characters' : ''}
              onFocus={e => e.target.style.borderColor = C.borderFocus}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 6,
            background: C.redDim, border: `1px solid ${C.red}`,
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
            width: '100%', marginTop: 24, padding: '11px 0',
            borderRadius: 6, border: 'none',
            background: loading || !email || !password ? C.surfaceHover : C.blue,
            color: loading || !email || !password ? C.textMuted : '#fff',
            fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            transition: 'all 0.15s',
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
