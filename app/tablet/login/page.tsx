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
    // Auto-submit na 4 cijfers (pas aan als PIN langer is)
    if (next.length >= 4) submit(next)
  }

  function backspace() {
    setPin((p) => p.slice(0, -1))
    setError('')
  }

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length)

  return (
    <main className="min-h-screen flex flex-col items-center justify-center" style={{ backgroundColor: '#083046' }}>
      <div className="mb-8">
        <Image
          src="/Coolpinguin Logo wit rental & sales.png"
          alt="Coolpinguin"
          width={200}
          height={75}
          style={{ objectFit: 'contain' }}
        />
      </div>

      <div className="bg-white rounded-3xl shadow-2xl px-10 py-10 w-full max-w-xs flex flex-col items-center">
        <h1 className="text-xl font-bold text-[#083046] mb-1">Tablet toegang</h1>
        <p className="text-sm text-gray-400 mb-7">Voer de PIN in</p>

        {/* PIN dots */}
        <div className="flex gap-4 mb-6">
          {dots.map((filled, i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full border-2 transition-all ${filled ? 'bg-[#083046] border-[#083046]' : 'border-gray-300'}`}
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
              onClick={() => press(d)}
              disabled={loading}
              className="h-16 rounded-2xl text-2xl font-semibold text-[#083046] bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-40 select-none"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            onClick={() => press('0')}
            disabled={loading}
            className="h-16 rounded-2xl text-2xl font-semibold text-[#083046] bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-40 select-none"
          >
            0
          </button>
          <button
            onClick={backspace}
            disabled={loading || pin.length === 0}
            className="h-16 rounded-2xl text-2xl text-gray-400 bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-40 select-none"
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
