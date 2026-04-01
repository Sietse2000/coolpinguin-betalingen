'use client'

import { useEffect, useState } from 'react'

interface Factuur {
  invoiceId: string
  customerName: string | null
  openAmount: string
  invoiceDate: string | null
  dueDate: string | null
  label: string | null
}

interface Categorie {
  key: string
  kleur: 'blue' | 'yellow' | 'orange' | 'red' | 'gray'
  label: string
  aantal: number
  totaal: number
  facturen: Factuur[]
}

interface DebiteurenData {
  categorieen: Categorie[]
  totaalOpenstaand: number
  aantalFacturen: number
  lastSync: string | null
}

const KLEUR: Record<string, { card: string; badge: string; bedrag: string }> = {
  blue:   { card: 'border-blue-200 bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   bedrag: 'text-blue-700'   },
  yellow: { card: 'border-yellow-200 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', bedrag: 'text-yellow-700' },
  orange: { card: 'border-orange-200 bg-orange-50', badge: 'bg-orange-100 text-orange-700', bedrag: 'text-orange-700' },
  red:    { card: 'border-red-200 bg-red-50',     badge: 'bg-red-100 text-red-700',     bedrag: 'text-red-700'    },
  gray:   { card: 'border-gray-200 bg-gray-50',   badge: 'bg-gray-100 text-gray-600',   bedrag: 'text-gray-600'   },
}

function fmt(amount: number) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DebiteurenPage() {
  const [data, setData] = useState<DebiteurenData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/debiteuren')
    const d = await res.json()
    setData(d)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function sync() {
    setSyncing(true)
    setMsg(null)
    try {
      const res = await fetch('/api/invoices/sync', { method: 'POST' })
      const d = await res.json()
      if (res.ok) {
        setMsg({ text: `Gesynchroniseerd: ${d.synced} facturen bijgewerkt`, ok: true })
        await load()
      } else {
        setMsg({ text: d.error ?? 'Sync mislukt', ok: false })
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#083046]">Debiteurenstaat</h1>
          {data?.lastSync && (
            <p className="text-xs text-gray-400 mt-0.5">
              Laatste sync: {fmtDate(data.lastSync)}
            </p>
          )}
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="px-4 py-2 bg-[#083046] text-white rounded-lg text-sm font-medium hover:bg-[#0a3d5c] disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Bezig…' : '↻ Synchroniseer'}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">Laden…</div>
      ) : !data || data.aantalFacturen === 0 ? (
        <div className="card p-10 text-center text-gray-400">
          <div className="text-3xl mb-2">📭</div>
          <div className="text-sm">Geen openstaande facturen gevonden.</div>
          <div className="text-xs mt-1">Synchroniseer eerst om de laatste stand op te halen.</div>
        </div>
      ) : (
        <>
          {/* Totaalbalk */}
          <div className="card p-5 mb-6 flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Totaal openstaand</div>
              <div className="text-3xl font-bold text-[#083046]">{fmt(data.totaalOpenstaand)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{data.aantalFacturen} facturen</div>
            </div>
            <div className="flex gap-4">
              {data.categorieen.map((cat) => {
                const k = KLEUR[cat.kleur]
                return (
                  <div key={cat.key} className="text-right">
                    <div className={`text-xs px-2 py-0.5 rounded-full font-medium mb-1 ${k.badge}`}>{cat.label}</div>
                    <div className={`text-lg font-bold ${k.bedrag}`}>{fmt(cat.totaal)}</div>
                    <div className="text-xs text-gray-400">{cat.aantal} facturen</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Categorieën */}
          <div className="space-y-3">
            {data.categorieen.map((cat) => {
              const k = KLEUR[cat.kleur]
              const isOpen = openCat === cat.key
              return (
                <div key={cat.key} className={`card border ${k.card} overflow-hidden`}>
                  <button
                    className="w-full px-5 py-4 flex items-center justify-between text-left"
                    onClick={() => setOpenCat(isOpen ? null : cat.key)}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${k.badge}`}>
                        {cat.label}
                      </span>
                      <span className="text-sm text-gray-500">{cat.aantal} facturen</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-xl font-bold ${k.bedrag}`}>{fmt(cat.totaal)}</span>
                      <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-current border-opacity-10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="px-5 py-2 text-left font-medium">Factuur</th>
                            <th className="px-5 py-2 text-left font-medium">Klant</th>
                            <th className="px-5 py-2 text-left font-medium">Factuurdatum</th>
                            <th className="px-5 py-2 text-left font-medium">Vervaldatum</th>
                            <th className="px-5 py-2 text-right font-medium">Openstaand</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.facturen.map((f) => {
                            const verlopen = f.dueDate && new Date(f.dueDate) < new Date()
                            return (
                              <tr key={f.invoiceId} className="border-b border-gray-100 last:border-0 hover:bg-white/50">
                                <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{f.invoiceId}</td>
                                <td className="px-5 py-2.5 font-medium text-[#083046]">{f.customerName ?? '—'}</td>
                                <td className="px-5 py-2.5 text-gray-500">{fmtDate(f.invoiceDate)}</td>
                                <td className={`px-5 py-2.5 ${verlopen ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                  {fmtDate(f.dueDate)}{verlopen ? ' ⚠' : ''}
                                </td>
                                <td className="px-5 py-2.5 text-right font-semibold text-[#083046]">
                                  {fmt(Number(f.openAmount))}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
