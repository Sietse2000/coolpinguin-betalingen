'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function TabletLoginPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pin || loading) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/tablet/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })
    if (res.ok) {
      router.push('/tablet')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Onjuiste PIN')
      setPin('')
      setLoading(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#083046', padding: 24 }}>
      <Image src="/penguin.png" alt="" width={80} height={80} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)', marginBottom: 24 }} />

      <div style={{ backgroundColor: '#fff', borderRadius: 24, padding: 32, width: '100%', maxWidth: 320, boxShadow: '0 8px 48px rgba(0,0,0,0.5)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#083046', textAlign: 'center', marginBottom: 8 }}>Tablet toegang</h1>
        <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 24 }}>Typ de PIN en druk op Enter</p>

        {error && (
          <p style={{ color: '#ef4444', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{error}</p>
        )}

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            disabled={loading}
            autoFocus
            placeholder="PIN"
            style={{ width: '100%', padding: 16, fontSize: 28, textAlign: 'center', letterSpacing: '0.3em', borderRadius: 12, border: '2px solid #c8d4de', backgroundColor: '#f0f4f8', color: '#083046', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
          />
          <button
            type="submit"
            disabled={loading || !pin}
            style={{ width: '100%', padding: 16, fontSize: 16, fontWeight: 700, color: '#fff', backgroundColor: '#083046', border: 'none', borderRadius: 12, opacity: loading || !pin ? 0.5 : 1 }}
          >
            {loading ? 'Controleren…' : 'Inloggen →'}
          </button>
        </form>
      </div>
    </main>
  )
}
