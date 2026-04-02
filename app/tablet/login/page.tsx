'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function TabletLoginPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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
    }
  }

  function press(digit: string) {
    if (loading) return
    const next = pin + digit
    setPin(next)
    setError('')
    if (next.length >= 4) submit(next)
  }

  function backspace() {
    if (loading) return
    setPin((p) => p.slice(0, -1))
    setError('')
  }

  // onTouchStart + preventDefault() = directe response op touch, voorkomt 300ms delay
  // en onderdrukt het gesynthesiseerde click-event zodat onClick niet dubbel vuurt.
  // onClick = fallback voor desktop/muis.
  function makeHandlers(fn: () => void) {
    return {
      onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); fn() },
      onClick: fn,
    }
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
          border: '2px solid rgba(255,255,255,0.6)',
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

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button
              key={d}
              {...makeHandlers(() => press(d))}
              disabled={loading}
              className="select-none"
              style={{
                height: 64,
                borderRadius: 16,
                fontSize: 24,
                fontWeight: 600,
                color: '#083046',
                backgroundColor: '#e8edf2',
                border: '1px solid #c8d4de',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                opacity: loading ? 0.4 : 1,
              }}
            >
              {d}
            </button>
          ))}
          <div />
          <button
            {...makeHandlers(() => press('0'))}
            disabled={loading}
            className="select-none"
            style={{
              height: 64,
              borderRadius: 16,
              fontSize: 24,
              fontWeight: 600,
              color: '#083046',
              backgroundColor: '#e8edf2',
              border: '1px solid #c8d4de',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              opacity: loading ? 0.4 : 1,
            }}
          >
            0
          </button>
          <button
            {...makeHandlers(backspace)}
            disabled={loading || pin.length === 0}
            className="select-none"
            style={{
              height: 64,
              borderRadius: 16,
              fontSize: 24,
              color: '#6b7280',
              backgroundColor: '#e8edf2',
              border: '1px solid #c8d4de',
              cursor: loading || pin.length === 0 ? 'default' : 'pointer',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              opacity: loading || pin.length === 0 ? 0.4 : 1,
            }}
          >
            ←
          </button>
        </div>

        {loading && (
          <div className="mt-6 text-sm text-gray-400">Controleren…</div>
        )}
      </div>
    </main>
  )
}
