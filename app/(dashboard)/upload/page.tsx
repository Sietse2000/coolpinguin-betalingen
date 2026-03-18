'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

interface UploadResult {
  uploadId: string
  total: number
  new: number
  duplicates: number
  skippedDebit: number
  autoProcessing: number
  needsReview: number
  pending: number
}

export default function UploadPage() {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    setResult(null)
    setFilename(file.name)

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/uploads', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Upload mislukt')
      else setResult(data)
    } catch {
      setError('Netwerkfout bij upload')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="page-title">Bankbestand uploaden</h1>
      <p className="page-sub">
        Upload een ING bankafschrift in CAMT.053 (.xml) of MT940 (.sta) formaat.
        Veilige matches worden automatisch verwerkt. Twijfelgevallen gaan naar handmatige controle.
      </p>

      {/* Drop zone */}
      <div
        className={`mb-4 rounded-lg border-2 border-dashed p-12 flex flex-col items-center justify-center cursor-pointer transition-colors ${
          dragging
            ? 'border-cp-blue bg-cp-blue-light'
            : 'border-gray-300 bg-white hover:border-cp-blue hover:bg-cp-blue-light'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.sta,.mt940,.940"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />

        {uploading ? (
          <div className="text-center">
            <div className="text-4xl mb-3 text-cp-blue animate-spin inline-block">⟳</div>
            <p className="text-sm text-cp-dark font-medium">Verwerken: {filename}</p>
            <p className="text-xs text-gray-400 mt-1">Even geduld…</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-5xl mb-3 text-cp-blue">↑</div>
            <p className="text-base font-medium text-cp-dark">Sleep een bestand hierheen</p>
            <p className="text-sm text-gray-500 mt-1">of klik om te kiezen</p>
            <div className="flex gap-2 justify-center mt-4">
              {['.xml (CAMT.053)', '.sta (MT940)', '.mt940'].map((ext) => (
                <span key={ext} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">{ext}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fout */}
      {error && (
        <div className="alert-error mb-4">
          <strong>Fout:</strong> {error}
        </div>
      )}

      {/* Resultaat */}
      {result && !uploading && (
        <div className="card p-6">
          <h2 className="text-base font-medium text-cp-dark mb-4">Bestand verwerkt: {filename}</h2>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Totaal gevonden',     value: result.total,           color: 'text-cp-dark' },
              { label: 'Nieuw verwerkt',       value: result.new,             color: 'text-cp-dark' },
              { label: 'Duplicaten',           value: result.duplicates,      color: 'text-gray-400' },
              { label: 'Afschrijvingen (overgeslagen)', value: result.skippedDebit, color: 'text-gray-400' },
              { label: 'Auto verwerkt',        value: result.autoProcessing,  color: 'text-green-600' },
              { label: 'Handmatige controle',  value: result.needsReview,     color: 'text-amber-600' },
              { label: 'Geen match',           value: result.pending,         color: 'text-gray-500' },
            ].map((item) => (
              <div key={item.label} className="bg-gray-50 rounded p-3 text-center">
                <div className={`text-2xl font-medium ${item.color}`}>{item.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            {result.needsReview > 0 && (
              <Link href="/review" className="btn-primary">
                Handmatige controle ({result.needsReview}) →
              </Link>
            )}
            <Link href="/transactions" className="btn-secondary">
              Alle transacties
            </Link>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="mt-6 card p-4">
        <h3 className="text-sm font-medium text-cp-dark mb-3">Wanneer wordt automatisch verwerkt?</h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <span className="text-green-500 font-bold mt-0.5">✓</span>
            <span>Exact factuurnummer in omschrijving <strong>én</strong> bedrag klopt exact → auto verwerkt + label "Betaald"</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-500 font-bold mt-0.5">↓</span>
            <span>Exact factuurnummer + lager bedrag → payment geboekt, label <strong>niet</strong> gezet (deelbetaling)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-500 font-bold mt-0.5">⚑</span>
            <span>Alles anders → naar handmatige controle, <strong>nooit</strong> automatisch</span>
          </div>
        </div>
      </div>
    </div>
  )
}
