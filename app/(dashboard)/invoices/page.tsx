'use client'

import { useEffect, useState } from 'react'

interface Invoice {
  invoiceId: string
  customerName: string | null
  totalAmount: string
  openAmount: string
  invoiceDate: string | null
  dueDate: string | null
  status: string | null
  syncedAt: string
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  async function load(q = '') {
    setLoading(true)
    const res = await fetch(`/api/invoices?q=${encodeURIComponent(q)}&limit=100`)
    const data = await res.json()
    setInvoices(data.invoices ?? [])
    setTotal(data.total ?? 0)
    setLastSync(data.lastSync)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function sync() {
    setSyncing(true)
    setMsg(null)
    try {
      const res = await fetch('/api/invoices/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg({ text: `${data.synced} facturen gesynchroniseerd (${data.errors} fouten)`, type: 'ok' })
      await load(search)
    } catch (err) {
      setMsg({ text: `Fout: ${err instanceof Error ? err.message : 'Onbekend'}`, type: 'err' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">Openstaande facturen</h1>
          <p className="text-sm text-gray-500">
            {lastSync
              ? `Laatste sync: ${new Date(lastSync).toLocaleString('nl-NL')}`
              : 'Nog niet gesynchroniseerd'}
          </p>
        </div>
        <button onClick={sync} disabled={syncing} className="btn-primary">
          {syncing ? 'Synchroniseren…' : 'Sync vanuit RentMagic'}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 ${msg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
          {msg.text}
        </div>
      )}

      {total === 0 && !loading && (
        <div className="alert-warning mb-4">
          Geen facturen in cache. Klik op "Sync vanuit RentMagic" om facturen op te halen.
          Zonder factuurcache kan de app geen matches vinden.
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          placeholder="Zoek op factuur-ID of klantnaam…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); load(e.target.value) }}
          className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-cp-blue"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
          {loading ? 'Laden…' : `${total} facturen in cache`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Factuur-ID', 'Klant', 'Totaal', 'Open bedrag', 'Factuurdatum', 'Vervaldatum', 'Status'].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => {
                const open = parseFloat(inv.openAmount)
                const total = parseFloat(inv.totalAmount)
                const isPaid = open <= 0
                return (
                  <tr key={inv.invoiceId} className={`hover:bg-gray-50 ${isPaid ? 'opacity-50' : ''}`}>
                    <td className="td font-mono font-medium text-cp-blue">{inv.invoiceId}</td>
                    <td className="td">{inv.customerName ?? '—'}</td>
                    <td className="td font-mono text-sm">€ {total.toFixed(2)}</td>
                    <td className="td font-mono font-medium text-sm">€ {open.toFixed(2)}</td>
                    <td className="td text-xs text-gray-500">
                      {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('nl-NL') : '—'}
                    </td>
                    <td className="td text-xs text-gray-500">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('nl-NL') : '—'}
                    </td>
                    <td className="td">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        {inv.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {invoices.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="td py-6 text-center text-gray-400">
                    Geen resultaten
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
