'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Inloggen mislukt')
      setLoading(false)
    }
  }

  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Coolpinguin – Betalingen</h1>
        <input
          type="password"
          placeholder="Wachtwoord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          style={{ padding: '8px 12px', fontSize: 16, border: '1px solid #ccc', borderRadius: 4 }}
        />
        {error && <p style={{ margin: 0, color: 'red', fontSize: 14 }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '8px 12px', fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4, border: 'none', background: '#0070f3', color: '#fff' }}
        >
          {loading ? 'Bezig...' : 'Inloggen'}
        </button>
      </form>
    </main>
  )
}
