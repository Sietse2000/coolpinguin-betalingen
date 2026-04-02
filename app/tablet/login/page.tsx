'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'

function LoginForm() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoTried, setAutoTried] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  async function submit(p: string) {
    const trimmed = p.trim()
    if (!trimmed) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/tablet/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: trimmed }),
    })
    if (res.ok) {
      router.push('/tablet')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Onjuiste PIN')
      setPin('')
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // Auto-submit als ?pin=XXXX in de URL staat
  useEffect(() => {
    if (autoTried) return
    const pinParam = searchParams.get('pin')
    if (pinParam) {
      setAutoTried(true)
      setPin(pinParam)
      submit(pinParam)
    }
  }, [searchParams, autoTried])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setPin(val)
    setError('')
    if (val.length >= 4) submit(val)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submit(pin)
  }

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length)

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center gap-6 px-4"
      style={{ backgroundColor: '#083046' }}
    >
      <Image
        src="/penguin.png"
        alt="Coolpinguin"
        width={90}
        height={90}
        style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
      />

      <div
        className="rounded-3xl px-8 py-8 w-full max-w-sm flex flex-col items-center"
        style={{ backgroundColor: '#ffffff', boxShadow: '0 8px 48px rgba(0,0,0,0.5)' }}
      >
        <h1 className="text-xl font-bold text-[#083046] mb-1">Tablet toegang</h1>
        <p className="text-sm text-gray-500 mb-6">Voer de PIN in en druk op Enter</p>

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

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={handleChange}
            disabled={loading}
            autoFocus
            maxLength={6}
            placeholder="Typ PIN…"
            style={{
              width: '100%',
              padding: '16px',
              fontSize: 28,
              fontWeight: 700,
              textAlign: 'center',
              letterSpacing: '0.4em',
              borderRadius: 16,
              border: '2px solid #c8d4de',
              backgroundColor: '#f0f4f8',
              color: '#083046',
              outline: 'none',
              caretColor: '#083046',
              WebkitAppearance: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#083046')}
            onBlur={(e) => (e.target.style.borderColor = '#c8d4de')}
          />
          {/* Verborgen submit zodat Enter altijd werkt */}
          <input type="submit" style={{ display: 'none' }} />
        </form>

        {loading && (
          <div className="mt-4 text-sm text-gray-400">Controleren…</div>
        )}

        {/* Alternatief: inloggen via adresbalk */}
        <div
          className="mt-6 w-full rounded-xl p-4 text-center"
          style={{ backgroundColor: '#f0f4f8', border: '1px solid #c8d4de' }}
        >
          <p className="text-xs text-gray-500 mb-1 font-medium">Werkt het niet? Typ dit in de adresbalk:</p>
          <p className="text-xs font-mono text-[#083046] break-all">
            coolpinguin-betalingen.vercel.app/tablet/login?pin=<span className="text-gray-400">JOUWPIN</span>
          </p>
        </div>
      </div>
    </main>
  )
}

export default function TabletLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
