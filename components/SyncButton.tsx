'use client'

import { useState } from 'react'

export default function SyncButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [info, setInfo] = useState('')

  async function sync() {
    setState('loading')
    setInfo('')
    try {
      const res = await fetch('/api/invoices/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Sync mislukt')
      setState('ok')
      setInfo(`${data.synced} facturen gesynchroniseerd`)
      setTimeout(() => setState('idle'), 4000)
    } catch (err) {
      setState('err')
      setInfo(err instanceof Error ? err.message : 'Fout')
      setTimeout(() => setState('idle'), 5000)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={sync}
        disabled={state === 'loading'}
        className="btn-secondary text-base px-5 py-2.5"
      >
        {state === 'loading' ? 'Synchroniseren…' : 'Stap 1 — Facturen synchroniseren'}
      </button>
      {info && (
        <span className={`text-xs ${state === 'err' ? 'text-red-600' : 'text-green-600'}`}>
          {info}
        </span>
      )}
    </div>
  )
}
