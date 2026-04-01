'use client'

import { useEffect, useState } from 'react'

interface Factuur {
  invoiceId: string
  customerName: string | null
  openAmount: string
  totalExcVat: string | null
  totalVat: string | null
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

const KLEUR: Record<string, { border: string; bg: string; badge: string; badgeText: string; bedrag: string; row: string }> = {
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50/60',   badge: 'bg-blue-100',   badgeText: 'text-blue-700',   bedrag: 'text-blue-700',   row: 'hover:bg-blue-50'   },
  yellow: { border: 'border-yellow-200', bg: 'bg-yellow-50/60', badge: 'bg-yellow-100', badgeText: 'text-yellow-700', bedrag: 'text-yellow-700', row: 'hover:bg-yellow-50' },
  orange: { border: 'border-orange-200', bg: 'bg-orange-50/60', badge: 'bg-orange-100', badgeText: 'text-orange-700', bedrag: 'text-orange-700', row: 'hover:bg-orange-50' },
  red:    { border: 'border-red-200',    bg: 'bg-red-50/60',    badge: 'bg-red-100',    badgeText: 'text-red-700',    bedrag: 'text-red-700',    row: 'hover:bg-red-50'    },
  gray:   { border: 'border-gray-200',   bg: 'bg-gray-50/60',   badge: 'bg-gray-100',   badgeText: 'text-gray-600',   bedrag: 'text-gray-500',   row: 'hover:bg-gray-50'   },
}

const fmt = (n: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const fmtSync = (iso: string) =>
  new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function DebiteurenPage() {
  const [data, setData] = useState<DebiteurenData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/debiteuren')
    setData(await res.json())
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
        setMsg({ text: `${d.synced} facturen bijgewerkt`, ok: true })
        await load()
      } else {
        setMsg({ text: d.error ?? 'Sync mislukt', ok: false })
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#083046]">Debiteurenstaat</h1>
          <p className="text-sm text-gray-400 mt-1">
            {data?.lastSync ? `Laatste sync: ${fmtSync(data.lastSync)}` : 'Nog niet gesynchroniseerd'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {msg && (
            <span className={`text-sm px-3 py-1.5 rounded-lg ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {msg.ok ? '✓' : '✗'} {msg.text}
            </span>
          )}
          <button
            onClick={sync}
            disabled={syncing}
            className="px-5 py-2.5 bg-[#083046] text-white rounded-xl text-sm font-medium hover:bg-[#0a3d5c] disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <span className={syncing ? 'animate-spin inline-block' : ''}>↻</span>
            {syncing ? 'Bezig…' : 'Synchroniseer'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-20 text-center">Laden…</div>
      ) : !data || data.aantalFacturen === 0 ? (
        <div className="card p-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <div className="text-sm font-medium">Geen openstaande facturen gevonden</div>
          <div className="text-xs mt-1">Synchroniseer eerst om de laatste stand op te halen</div>
        </div>
      ) : (
        <>
          {/* Totaalbalk */}
          <div className="card p-6 mb-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Totaal openstaand</div>
                <div className="text-4xl font-bold text-[#083046]">{fmt(data.totaalOpenstaand)}</div>
                <div className="text-xs text-gray-400 mt-1.5">incl. BTW &nbsp;·&nbsp; {data.aantalFacturen} facturen</div>
              </div>
              <div className="flex gap-6 flex-wrap justify-end">
                {data.categorieen.map((cat) => {
                  const k = KLEUR[cat.kleur]
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
                      className="text-right group"
                    >
                      <div className={`text-xs px-2.5 py-1 rounded-full font-semibold mb-1.5 inline-block ${k.badge} ${k.badgeText} group-hover:opacity-80`}>
                        {cat.label}
                      </div>
                      <div className={`text-xl font-bold ${k.bedrag}`}>{fmt(cat.totaal)}</div>
                      <div className="text-xs text-gray-400">{cat.aantal} facturen</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Categorieën */}
          <div className="space-y-4">
            {data.categorieen.map((cat) => {
              const k = KLEUR[cat.kleur]
              const isOpen = openCat === cat.key
              const totaalExcl = cat.facturen.reduce((s, f) => s + (f.totalExcVat ? Number(f.totalExcVat) : 0), 0)
              const totaalBtw  = cat.facturen.reduce((s, f) => s + (f.totalVat ? Number(f.totalVat) : 0), 0)

              return (
                <div key={cat.key} className={`rounded-2xl border ${k.border} overflow-hidden shadow-sm`}>
                  <button
                    className={`w-full px-6 py-5 flex items-center justify-between text-left transition-colors ${isOpen ? k.bg : 'bg-white hover:bg-gray-50/80'}`}
                    onClick={() => setOpenCat(isOpen ? null : cat.key)}
                  >
                    <div className="flex items-center gap-4">
                      <span className={`text-sm px-3 py-1 rounded-full font-semibold ${k.badge} ${k.badgeText}`}>
                        {cat.label}
                      </span>
                      <span className="text-sm text-gray-400">{cat.aantal} facturen</span>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${k.bedrag}`}>{fmt(cat.totaal)}</div>
                        <div className="text-xs text-gray-400 mt-0.5">incl. BTW</div>
                      </div>
                      <span className={`text-gray-400 text-sm transition-transform ${isOpen ? 'rotate-180' : ''} inline-block`}>▼</span>
                    </div>
                  </button>

                  {isOpen && (
                    <>
                      {/* BTW-subtotaal balk */}
                      <div className={`px-6 py-3 ${k.bg} border-t ${k.border} flex gap-8 text-sm`}>
                        <span className="text-gray-500">Incl. BTW: <span className="font-semibold text-[#083046]">{fmt(cat.totaal)}</span></span>
                        <span className="text-gray-400">waarvan BTW: <span className="font-medium text-gray-500">{fmt(totaalBtw)}</span></span>
                        <span className="text-gray-400">excl. BTW: <span className="font-medium text-gray-500">{fmt(totaalExcl)}</span></span>
                      </div>

                      <div className="bg-white">
                        <table className="w-full">
                          <thead>
                            <tr className={`text-xs font-semibold uppercase tracking-wide text-gray-400 border-b ${k.border}`}>
                              <th className="px-6 py-3 text-left">Factuur</th>
                              <th className="px-6 py-3 text-left">Klant</th>
                              <th className="px-6 py-3 text-left">Factuurdatum</th>
                              <th className="px-6 py-3 text-left">Vervaldatum</th>
                              <th className="px-6 py-3 text-right">Openstaand (incl. BTW)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {cat.facturen.map((f) => {
                              const verlopen = f.dueDate && new Date(f.dueDate) < new Date()
                              return (
                                <tr key={f.invoiceId} className={`text-sm transition-colors ${k.row}`}>
                                  <td className="px-6 py-4 font-mono text-xs text-gray-500">{f.invoiceId}</td>
                                  <td className="px-6 py-4 font-semibold text-[#083046]">{f.customerName ?? '—'}</td>
                                  <td className="px-6 py-4 text-gray-500">{fmtDate(f.invoiceDate)}</td>
                                  <td className="px-6 py-4">
                                    {verlopen
                                      ? <span className="text-red-600 font-semibold">{fmtDate(f.dueDate)} ⚠</span>
                                      : <span className="text-gray-500">{fmtDate(f.dueDate)}</span>
                                    }
                                  </td>
                                  <td className="px-6 py-4 text-right font-bold text-[#083046]">
                                    {fmt(Number(f.openAmount))}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
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
