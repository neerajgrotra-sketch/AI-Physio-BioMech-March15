'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const C = {
  bg: '#0d1117', surface: '#161b22', border: '#21262d',
  text: '#e6edf3', textMuted: '#7d8590',
  green: '#3fb950', red: '#f85149', yellow: '#d29922', blue: '#388bfd',
}

interface TestResult {
  name: string
  status: 'pending' | 'pass' | 'fail' | 'running'
  detail: string
  ms?: number
}

export default function TestPage() {
  const [results, setResults] = useState<TestResult[]>([
    { name: 'Env: SUPABASE_URL', status: 'pending', detail: '' },
    { name: 'Env: ANON_KEY format', status: 'pending', detail: '' },
    { name: 'Network: Auth health', status: 'pending', detail: '' },
    { name: 'Network: REST direct fetch', status: 'pending', detail: '' },
    { name: 'Query: exercise_templates', status: 'pending', detail: '' },
    { name: 'Query: clinics', status: 'pending', detail: '' },
  ])
  const [running, setRunning] = useState(false)

  const update = (index: number, partial: Partial<TestResult>) => {
    setResults(prev => prev.map((r, i) => i === index ? { ...r, ...partial } : r))
  }

  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms — ${label} never responded`)), ms)
      )
    ])

  const runTests = async () => {
    setRunning(true)
    setResults(prev => prev.map(r => ({ ...r, status: 'pending' as const, detail: '', ms: undefined })))

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Test 1: URL
    update(0, { status: 'running', detail: 'Checking...' })
    if (!url) {
      update(0, { status: 'fail', detail: 'MISSING — not set in env' })
    } else {
      update(0, { status: 'pass', detail: url })
    }

    // Test 2: Key format
    update(1, { status: 'running', detail: 'Checking...' })
    if (!key) {
      update(1, { status: 'fail', detail: 'MISSING — not set in env' })
    } else {
      const parts = key.split('.')
      if (parts.length !== 3) {
        update(1, { status: 'fail', detail: `INVALID — has ${parts.length} parts (need 3). Key: ${key.slice(0, 30)}...` })
      } else {
        update(1, { status: 'pass', detail: `Valid JWT — ${key.length} chars, starts: ${key.slice(0, 20)}...` })
      }
    }

    if (!url || !key) { setRunning(false); return }

    // Test 3: Auth health
    update(2, { status: 'running', detail: 'Fetching...' })
    try {
      const start = Date.now()
      const res = await withTimeout(
        fetch(`${url}/auth/v1/health`, { headers: { 'apikey': key } }),
        8000, 'auth health'
      )
      const ms = Date.now() - start
      const text = await res.text()
      update(2, { status: res.ok ? 'pass' : 'fail', detail: `${res.status} in ${ms}ms — ${text.slice(0, 80)}`, ms })
    } catch (e: unknown) {
      update(2, { status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }

    // Test 4: Direct REST fetch
    update(3, { status: 'running', detail: 'Fetching...' })
    try {
      const start = Date.now()
      const res = await withTimeout(
        fetch(`${url}/rest/v1/exercise_templates?limit=1&select=name`, {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          }
        }),
        8000, 'REST fetch'
      )
      const ms = Date.now() - start
      const text = await res.text()
      update(3, { status: res.ok ? 'pass' : 'fail', detail: `${res.status} in ${ms}ms — ${text.slice(0, 150)}`, ms })
    } catch (e: unknown) {
      update(3, { status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }

    // Test 5: supabase-js query — exercise_templates
    update(4, { status: 'running', detail: 'Querying via supabase-js...' })
    try {
      const start = Date.now()
      const supabase = createBrowserClient(url, key)
      const { data, error } = await withTimeout(
        supabase.from('exercise_templates').select('name').eq('is_vanilla', true).limit(5),
        8000, 'exercise_templates'
      )
      const ms = Date.now() - start
      if (error) {
        update(4, { status: 'fail', detail: `ERROR ${ms}ms: ${error.message} | code: ${error.code} | hint: ${error.hint}`, ms })
      } else {
        update(4, { status: 'pass', detail: `${ms}ms — ${data?.length} rows: ${(data as {name:string}[])?.map(d => d.name).join(', ')}`, ms })
      }
    } catch (e: unknown) {
      update(4, { status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }

    // Test 6: clinics
    update(5, { status: 'running', detail: 'Querying via supabase-js...' })
    try {
      const start = Date.now()
      const supabase = createBrowserClient(url, key)
      const { data, error } = await withTimeout(
        supabase.from('clinics').select('id, name').limit(3),
        8000, 'clinics'
      )
      const ms = Date.now() - start
      if (error) {
        update(5, { status: 'fail', detail: `ERROR ${ms}ms: ${error.message} | code: ${error.code} | hint: ${error.hint}`, ms })
      } else {
        update(5, { status: 'pass', detail: `${ms}ms — ${data?.length} rows: ${(data as {name:string}[])?.map(d => d.name).join(', ')}`, ms })
      }
    } catch (e: unknown) {
      update(5, { status: 'fail', detail: e instanceof Error ? e.message : String(e) })
    }

    setRunning(false)
  }

  const statusColor = (s: TestResult['status']) => {
    if (s === 'pass') return C.green
    if (s === 'fail') return C.red
    if (s === 'running') return C.yellow
    return C.textMuted
  }

  const statusIcon = (s: TestResult['status']) => {
    if (s === 'pass') return '✓'
    if (s === 'fail') return '✗'
    if (s === 'running') return '⟳'
    return '○'
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: 40, fontFamily: 'monospace' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>AI Physio BioMech</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Supabase Connectivity Test</h1>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>Each test times out after 8 seconds</div>
        </div>

        <button
          onClick={runTests}
          disabled={running}
          style={{
            marginBottom: 32, padding: '10px 24px', borderRadius: 6, border: 'none',
            background: running ? C.surface : C.blue,
            color: running ? C.textMuted : '#fff',
            fontSize: 14, fontWeight: 600, cursor: running ? 'wait' : 'pointer',
          }}
        >
          {running ? 'Running tests...' : 'Run Tests'}
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {results.map((r, i) => (
            <div key={i} style={{
              background: C.surface,
              border: `1px solid ${r.status === 'fail' ? C.red : r.status === 'pass' ? C.green + '40' : C.border}`,
              borderRadius: 8, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: r.detail ? 6 : 0 }}>
                <span style={{ color: statusColor(r.status), fontSize: 16, fontWeight: 700, width: 20 }}>
                  {statusIcon(r.status)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.name}</span>
                {r.ms !== undefined && (
                  <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}>{r.ms}ms</span>
                )}
              </div>
              {r.detail && (
                <div style={{
                  fontSize: 12,
                  color: r.status === 'fail' ? C.red : C.textMuted,
                  paddingLeft: 30, wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {r.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
