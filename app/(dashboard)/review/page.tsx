'use client'

import { useEffect, useState, useCallback } from 'react'
import { ConfidenceBadge, ScenarioBadge, TransactionStatusBadge } from '@/components/StatusBadge'
import type { TransactionStatus } from '@/types'

interface Tx {
  id: string
  transactionDate: string
  amount: string
  currency: string
  creditDebit: string
  counterpartyName: string | null
  counterpartyIban: string | null
  description: string | null
  status: TransactionStatus
  matchedInvoiceId: string | null
  confidence: string | null
  matchType: string | null
  matchReason: string | null
}

interface Match {
  invoiceId: string
  invoiceAmount: number
  openAmount: number
  customerName?: string
  confidence: number
  scenario: string
  reason: string
  decision: {
    postPayment: boolean
    setLabel: boolean
    autoProcess: boolean
    reviewReason?: string
  }
}

interface ItemWithMatches {
  transaction: Tx
  matches: Match[]
}

export default function ReviewPage() {
  const [items, setItems] = useState<ItemWithMatches[]>([])
  const [selected, setSelected] = useState<ItemWithMatches | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [manualId, setManualId] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [total, setTotal] = useState(0)

  function notify(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/transactions?status=REVIEW&limit=100'),
        fetch('/api/transactions?status=PENDING&limit=100'),
      ])
      const [d1, d2] = await Promise.all([r1.json(), r2.json()])

      const txs: Tx[] = [
        ...(d1.transactions ?? []),
        ...(d2.transactions ?? []),
      ].filter((t: Tx) => t.status !== 'DUPLICATE')
      setTotal(txs.length)

      const enriched = await Promise.all(
        txs.map(async (tx) => {
          const r = await fetch(`/api/transactions/${tx.id}`)
          const d = await r.json()
          return { transaction: tx, matches: d.matches ?? [] } as ItemWithMatches
        })
      )
      setItems(enriched)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(txId: string, invoiceId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/transactions/${txId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Fout bij verwerken')

      if (data.paymentSuccess && data.labelSuccess) {
        notify('Betaling verwerkt en factuur op "Betaald" gezet', 'ok')
      } else if (data.paymentSuccess && !data.labelSuccess) {
        notify('Payment geboekt. Label niet gezet (deelbetaling of fout).', 'ok')
      } else {
        throw new Error(data.error ?? 'Payment mislukt')
      }

      await load()
      setSelected(null)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Fout', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function reject(txId: string) {
    setBusy(true)
    try {
      await fetch(`/api/transactions/${txId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      notify('Transactie afgewezen', 'ok')
      await load()
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  async function link(txId: string, invoiceId: string) {
    if (!invoiceId.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/transactions/${txId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoiceId.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Koppelen mislukt')
      notify(`Gekoppeld aan ${invoiceId}. Gebruik "Goedkeuren" om te verwerken.`, 'ok')
      await load()
      setSelected(prev => prev ? {
        ...prev,
        transaction: { ...prev.transaction, matchedInvoiceId: invoiceId, status: 'REVIEW' },
      } : null)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Fout', 'err')
    } finally {
      setBusy(false)
    }
  }

  const tx = selected?.transaction
  const matches = selected?.matches ?? []

  return (
    <div className="h-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">Handmatige controle</h1>
          <p className="text-sm text-gray-500">
            {loading ? 'Laden…' : `${total} transactie${total !== 1 ? 's' : ''} wacht${total === 1 ? '' : 'en'} op beoordeling`}
          </p>
        </div>
      </div>

      {!loading && items.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">✓</div>
          <p className="text-cp-dark font-medium">Alles beoordeeld</p>
          <p className="text-sm text-gray-400 mt-1">Geen transacties meer in de wachtrij</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex gap-4 h-[calc(100vh-160px)]">

          {/* Linker lijst */}
          <div className="w-80 flex-shrink-0 card overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs font-medium text-amber-700">
              ⚑ {items.length} te beoordelen
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {items.map(({ transaction: t, matches: m }) => {
                const top = m[0]
                const active = selected?.transaction.id === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => { setSelected({ transaction: t, matches: m }); setManualId('') }}
                    className={`w-full text-left px-3 py-3 transition-colors hover:bg-gray-50 ${active ? 'bg-cp-blue-light border-l-2 border-cp-blue' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs text-gray-400">
                        {new Date(t.transactionDate).toLocaleDateString('nl-NL')}
                      </span>
                      <span className="text-sm font-medium font-mono text-cp-dark">
                        € {parseFloat(t.amount).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-sm text-cp-dark truncate font-medium">
                      {t.counterpartyName ?? 'Onbekend'}
                    </div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {t.description ?? '—'}
                    </div>
                    {top ? (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <ScenarioBadge scenario={top.scenario} />
                        <ConfidenceBadge confidence={top.confidence} />
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 mt-1 block">Geen match gevonden</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Rechter detail */}
          <div className="flex-1 overflow-y-auto">
            {!selected ? (
              <div className="card p-10 flex items-center justify-center h-48 text-gray-400 text-sm">
                ← Selecteer een transactie
              </div>
            ) : (
              <div className="space-y-4">

                {/* Transactiedetails */}
                <div className="card p-5">
                  <h2 className="text-sm font-medium text-cp-dark mb-4 pb-2 border-b border-gray-100">
                    Transactiedetails
                  </h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <Field label="Datum" value={new Date(tx!.transactionDate).toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })} />
                    <Field label="Bedrag" value={`€ ${parseFloat(tx!.amount).toFixed(2)}`} mono />
                    <Field label="Tegenpartij" value={tx!.counterpartyName ?? '—'} />
                    <Field label="IBAN" value={tx!.counterpartyIban ?? '—'} mono />
                    <div className="col-span-2">
                      <Field label="Omschrijving" value={tx!.description ?? '—'} />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Status</div>
                      <TransactionStatusBadge status={tx!.status} />
                    </div>
                    {tx!.matchReason && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Reden voor review</div>
                        <div className="text-sm text-amber-700">{tx!.matchReason}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Match suggesties */}
                <div className="card">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h2 className="text-sm font-medium text-cp-dark">
                      Voorgestelde matches ({matches.length})
                    </h2>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {matches.length === 0 && (
                      <p className="px-5 py-4 text-sm text-gray-400">
                        Geen suggesties gevonden. Koppel handmatig hieronder.
                      </p>
                    )}
                    {matches.map((m) => (
                      <div key={m.invoiceId} className="px-5 py-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {/* Match header */}
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-mono font-medium text-cp-dark text-base">
                                {m.invoiceId}
                              </span>
                              <ConfidenceBadge confidence={m.confidence} />
                              <ScenarioBadge scenario={m.scenario} />
                            </div>

                            {/* Klant + bedragen */}
                            {m.customerName && (
                              <div className="text-sm text-gray-600 mb-1">{m.customerName}</div>
                            )}
                            <div className="text-xs text-gray-500 mb-2">
                              Totaalbedrag: € {m.invoiceAmount.toFixed(2)} &nbsp;·&nbsp;
                              Open: € {m.openAmount.toFixed(2)}
                            </div>

                            {/* Reden */}
                            <div className="text-xs text-gray-500 mb-2">{m.reason}</div>

                            {/* Wat gaat er gebeuren? */}
                            <div className="flex gap-2 text-xs">
                              <span className={`px-2 py-0.5 rounded ${m.decision.postPayment ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                                {m.decision.postPayment ? '✓ Payment boeken' : '✗ Geen payment'}
                              </span>
                              <span className={`px-2 py-0.5 rounded ${m.decision.setLabel ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-600'}`}>
                                {m.decision.setLabel ? '✓ Label "Betaald"' : '~ Label overgeslagen'}
                              </span>
                            </div>
                          </div>

                          {/* Actie — verberg bij duplicaat */}
                          {tx!.status !== 'DUPLICATE' && (
                            <button
                              onClick={() => approve(tx!.id, m.invoiceId)}
                              disabled={busy}
                              className="btn-primary ml-4 flex-shrink-0"
                            >
                              {busy ? '…' : 'Goedkeuren'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Handmatig koppelen */}
                <div className="card p-5">
                  <h3 className="text-sm font-medium text-cp-dark mb-3">Handmatig koppelen aan factuur</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Factuur-ID (bijv. I02235)"
                      value={manualId}
                      onChange={(e) => setManualId(e.target.value.toUpperCase())}
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-cp-blue font-mono"
                    />
                    <button
                      onClick={() => link(tx!.id, manualId)}
                      disabled={!manualId.trim() || busy}
                      className="btn-secondary"
                    >
                      Koppelen
                    </button>
                    {tx!.matchedInvoiceId && tx!.status !== 'DUPLICATE' && (
                      <button
                        onClick={() => approve(tx!.id, tx!.matchedInvoiceId!)}
                        disabled={busy}
                        className="btn-primary"
                      >
                        {busy ? '…' : `Verwerken (${tx!.matchedInvoiceId})`}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Na koppelen: gebruik "Goedkeuren" boven om de betaling te verwerken.
                  </p>
                </div>

                {/* Afwijzen */}
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-400">
                    Afwijzen betekent: geen payment, geen label. Transactie blijft zichtbaar als "Afgewezen".
                  </p>
                  <button onClick={() => reject(tx!.id)} disabled={busy} className="btn-danger">
                    Transactie afwijzen
                  </button>
                </div>

              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm text-cp-dark ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}
