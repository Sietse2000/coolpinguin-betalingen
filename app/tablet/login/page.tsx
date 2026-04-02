'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function TabletLoginPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function submit(p: string) {
    if (p.length < 1) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/tablet/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: p }),
    })
    if (res.ok) {
      router.push('/tablet')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Onjuiste PIN')
      setPin('')
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(val)
    setError('')
    if (val.length >= 4) submit(val)
  }

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length)

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ backgroundColor: '#083046' }}
    >
      <div className="mb-8">
        <Image
          src="/Coolpinguin Logo wit rental & sales.png"
          alt="Coolpinguin"
          width={200}
          height={75}
          style={{ objectFit: 'contain' }}
        />
      </div>

      <div
        className="rounded-3xl px-10 py-10 w-full max-w-xs flex flex-col items-center"
        style={{
          backgroundColor: '#ffffff',
          border: '2px solid rgba(255,255,255,0.3)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
        }}
      >
        <h1 className="text-xl font-bold text-[#083046] mb-1">Tablet toegang</h1>
        <p className="text-sm text-gray-500 mb-7">Voer de PIN in</p>

        {/* PIN dots */}
        <div className="flex gap-4 mb-6">
          {dots.map((filled, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded-full border-2 transition-all"
              style={{
                backgroundColor: filled ? '#083046' : 'transparent',
                borderColor: filled ? '#083046' : '#9ca3af',
              }}
            />
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-500 mb-4 font-medium">{error}</div>
        )}

        {/* Native input — opent het numerieke toetsenbord van het tablet zelf */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          value={pin}
          onChange={handleChange}
          disabled={loading}
          autoFocus
          maxLength={4}
          placeholder="····"
          style={{
            width: '100%',
            padding: '16px',
            fontSize: 32,
            fontWeight: 700,
            textAlign: 'center',
            letterSpacing: '0.5em',
            borderRadius: 16,
            border: '2px solid #c8d4de',
            backgroundColor: '#f0f4f8',
            color: '#083046',
            outline: 'none',
            caretColor: '#083046',
            WebkitAppearance: 'none',
          }}
          onFocus={(e) => (e.target.style.borderColor = '#083046')}
          onBlur={(e) => (e.target.style.borderColor = '#c8d4de')}
        />

        {loading && (
          <div className="mt-6 text-sm text-gray-400">Controleren…</div>
        )}
      </div>
    </main>
  )
}
