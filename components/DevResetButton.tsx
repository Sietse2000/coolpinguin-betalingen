'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DevResetButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const router = useRouter()

  async function handleReset() {
    if (!confirm('⚠️ DEV RESET: alle uploads en transacties worden verwijderd. Doorgaan?')) return

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/dev/reset', {
        method: 'POST',
        headers: { 'X-Dev-Reset': 'true' },
      })
      const data = await res.json()

      if (!res.ok) {
        setResult(`Fout: ${data.error}`)
      } else {
        setResult(`✓ Reset klaar — ${data.deleted.uploads} uploads verwijderd`)
        router.refresh()
      }
    } catch {
      setResult('Onverwachte fout bij reset')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleReset}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors font-medium"
      >
        {loading ? 'Resetten...' : '↺ Reset testdata'}
      </button>
      {result && (
        <span className="text-xs text-gray-500">{result}</span>
      )}
    </div>
  )
}
