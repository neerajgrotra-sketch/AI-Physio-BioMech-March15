'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const C = {
  bg: '#0d1117', surface: '#161b22', surfaceHover: '#1c2230',
  border: '#21262d', borderFocus: '#388bfd',
  text: '#e6edf3', textMuted: '#7d8590', textDim: '#484f58',
  green: '#3fb950', blue: '#388bfd',
  red: '#f85149', redDim: 'rgba(248,81,73,0.12)',
  yellow: '#d29922', yellowDim: 'rgba(210,153,34,0.12)',
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
  const [logs, setLogs] = useState<{ msg: string; color: string; time: string }[]>([])

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const log = (msg: string, color = C.textMuted) => {
    const time = new Date().toISOString().split('T')[1].slice(0, 12)
    setLogs(prev => [...prev, { msg, color, time }])
    console.log(`[${time}] ${msg}`)
  }

  // On mount: check existing session + env vars
  useEffect(() => {
    log(`NEXT_PUBLIC_SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ set' : '✗ MISSING'}`, process.env.NEXT_PUBLIC_SUPABASE_URL ? C.green : C.red)
    log(`NEXT_PUBLIC_SUPABASE_ANON_KEY: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✓ set' : '✗ MISSING'}`, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? C.green : C.red)
    log(`redirectTo param: ${redirectTo}`, C.textMuted)

    log('Checking existing session...', C.yellow)
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        log(`getSession error: ${error.message}`, C.red)
      } else if (session) {
        log(`Existing session found for: ${session.user.email}`, C.green)
        log(`Session expires: ${new Date(session.expires_at! * 1000).toISOString()}`, C.green)
      } else {
        log('No existing session — login required', C.textMuted)
      }
    })
  }, [])

  const handleSignIn = async () => {
    setLoading(true)
    setError(null)
    setLogs([])

    log('Starting signInWithPassword...', C.yellow)
    log(`Email: ${email}`, C.textMuted)
    log(`Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`, C.textMuted)

    try {
      const startTime = Date.now()
      log('Calling supabase.auth.signInWithPassword...', C.yellow)

      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT after 10 seconds')), 10000)
        )
      ]) as Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>

      const elapsed = Date.now() - startTime
      log(`Response received in ${elapsed}ms`, C.textMuted)

      if (result.error) {
        log(`Sign in ERROR: ${result.error.message}`, C.red)
        log(`Error status: ${result.error.status}`, C.red)
        setError(result.error.message)
        setLoading(false)
      } else {
        log(`Sign in SUCCESS`, C.green)
        log(`User: ${result.data.user?.email}`, C.green)
        log(`Session token: ${result.data.session?.access_token ? result.data.session.access_token.slice(0, 20) + '...' : 'NULL'}`, result.data.session ? C.green : C.red)

        if (result.data.session) {
          log(`Navigating to ${redirectTo} in 1 second...`, C.blue)
          setTimeout(() => {
            window.location.href = redirectTo
          }, 1000)
        } else {
          log('ERROR: Sign in succeeded but no session returned!', C.red)
          setLoading(false)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`EXCEPTION: ${msg}`, C.red)
      setError(msg)
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (!fullName.trim()) { setError('Full name is required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError(null)
    setLogs([])

    log('Starting signUp...', C.yellow)

    try {
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
        log(`Register ERROR: ${error.message}`, C.red)
        setError(error.message)
        setLoading(false)
      } else {
        log('Register SUCCESS — navigating...', C.green)
        window.location.href = redirectTo
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`EXCEPTION: ${msg}`, C.red)
      setError(msg)
      setLoading(false)
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
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}>

      {/* Login card */}
      <div style={{ width: '100%', maxWidth: 400, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 32 }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>AI Physio BioMech</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: C.text }}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </div>
        </div>

        <div style={{ display: 'flex', background: C.bg, borderRadius: 8, padding: 3, marginBottom: 24, gap: 3 }}>
          {(['signin', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null); setLogs([]) }} style={{
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
              <input style={inputStyle} type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Dr. Jane Smith" />
            </div>
          )}
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@clinic.com" />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: C.redDim, border: `1px solid ${C.red}`, color: C.red, fontSize: 13 }}>
            {error}
          </div>
        )}

        <button
          onClick={mode === 'signin' ? handleSignIn : handleRegister}
          disabled={loading || !email || !password}
          style={{
            width: '100%', marginTop: 24, padding: '11px 0', borderRadius: 6, border: 'none',
            background: loading || !email || !password ? C.surfaceHover : C.blue,
            color: loading || !email || !password ? C.textMuted : '#fff',
            fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </div>

      {/* Diagnostic log panel */}
      {logs.length > 0 && (
        <div style={{ width: '100%', maxWidth: 500, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Diagnostic Log
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'monospace', fontSize: 12 }}>
            {logs.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: C.textDim, flexShrink: 0 }}>{l.time}</span>
                <span style={{ color: l.color }}>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
