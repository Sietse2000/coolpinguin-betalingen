import { db } from '@/lib/db'
import { TransactionStatusBadge, ScenarioBadge, ConfidenceBadge } from '@/components/StatusBadge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

// Standaard actieve filters — duplicaten staan in een apart filter
const STATUS_FILTERS = [
  { value: '',                 label: 'Actieve items',    title: 'Alle actieve werkitems (excl. duplicaten)' },
  { value: 'REVIEW',          label: 'Controle nodig' },
  { value: 'PROCESSED',       label: 'Verwerkt' },
  { value: 'PARTIAL_SUCCESS', label: 'Deelbetaling' },
  { value: 'PENDING',         label: 'In behandeling' },
  { value: 'REJECTED',        label: 'Afgewezen' },
  { value: 'DUPLICATE',       label: 'Duplicaten',        title: 'Al verwerkt of factuur heeft geen openstaand saldo' },
]

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string }
}) {
  const status = searchParams.status ?? ''
  const page = parseInt(searchParams.page ?? '1', 10)
  const limit = 50
  const skip = (page - 1) * limit
  const now = new Date()

  // Gebruik dezelfde logica als de API route
  let where: object
  if (status === 'DUPLICATE') {
    where = { status: 'DUPLICATE' }
  } else if (status) {
    where = {
      status: status as never,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  } else {
    where = {
      status: { notIn: ['DUPLICATE'] as never[] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  }

  const [transactions, total, dupCount] = await Promise.all([
    db.bankTransaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      skip,
      take: limit,
    }),
    db.bankTransaction.count({ where }),
    db.bankTransaction.count({ where: { status: 'DUPLICATE' } }),
  ])

  const pages = Math.ceil(total / limit)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">Transacties</h1>
          <p className="text-sm text-gray-500">{total} transacties</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_FILTERS.map((f) => {
          const isDupFilter = f.value === 'DUPLICATE'
          return (
            <Link
              key={f.value}
              href={f.value ? `/transactions?status=${f.value}` : '/transactions'}
              title={f.title}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                status === f.value
                  ? isDupFilter
                    ? 'bg-purple-700 text-white border-purple-700'
                    : 'bg-cp-dark text-white border-cp-dark'
                  : isDupFilter
                  ? 'bg-white text-purple-600 border-purple-300 hover:border-purple-500'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-cp-blue hover:text-cp-blue'
              }`}
            >
              {f.label}
              {isDupFilter && dupCount > 0 && (
                <span className="ml-1.5 bg-purple-100 text-purple-700 px-1.5 rounded-full text-xs">
                  {dupCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Uitleg bij duplicaten filter */}
      {status === 'DUPLICATE' && (
        <div className="mb-4 p-3 rounded-lg bg-purple-50 border border-purple-200 text-sm text-purple-700">
          <strong>Duplicaten</strong> zijn transacties die niet verwerkt worden omdat de factuur
          al volledig betaald is, of omdat dezelfde betaling al eerder geboekt is.
          Ze worden nooit opnieuw naar RentMagic gestuurd.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Datum', 'Bedrag', 'Tegenpartij', 'Omschrijving', 'Factuurnr', 'Scenario', 'Conf.', 'Status', status === 'DUPLICATE' ? 'Reden' : ''].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={9} className="td py-8 text-center text-gray-400">
                    {status === 'DUPLICATE'
                      ? 'Geen duplicaten gevonden'
                      : 'Geen transacties gevonden'}
                  </td>
                </tr>
              )}
              {transactions.map((tx) => (
                <tr key={tx.id} className={`hover:bg-gray-50 ${tx.status === 'DUPLICATE' ? 'opacity-60' : ''}`}>
                  <td className="td whitespace-nowrap text-xs text-gray-500">
                    {tx.transactionDate.toLocaleDateString('nl-NL')}
                  </td>
                  <td className="td whitespace-nowrap font-mono font-medium">
                    <span className="text-green-700">
                      + € {parseFloat(tx.amount.toString()).toFixed(2)}
                    </span>
                  </td>
                  <td className="td max-w-36 truncate">{tx.counterpartyName ?? '—'}</td>
                  <td className="td max-w-48 truncate text-gray-500 text-xs">{tx.description ?? '—'}</td>
                  <td className="td font-mono text-xs text-cp-blue">{tx.matchedInvoiceId ?? '—'}</td>
                  <td className="td">
                    {tx.matchType ? <ScenarioBadge scenario={tx.matchType} /> : '—'}
                  </td>
                  <td className="td">
                    {tx.confidence
                      ? <ConfidenceBadge confidence={parseFloat(tx.confidence.toString())} />
                      : '—'}
                  </td>
                  <td className="td">
                    <TransactionStatusBadge status={tx.status as never} />
                  </td>
                  <td className="td text-xs text-gray-500 max-w-48">
                    {status === 'DUPLICATE'
                      ? (tx as { duplicateReason?: string }).duplicateReason ?? ''
                      : tx.status === 'REVIEW'
                      ? <Link href="/review" className="btn-ghost text-xs px-2 py-1">Beoordelen</Link>
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-400">pagina {page} van {pages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/transactions?${status ? `status=${status}&` : ''}page=${page - 1}`} className="btn-secondary text-xs">← Vorige</Link>
              )}
              {page < pages && (
                <Link href={`/transactions?${status ? `status=${status}&` : ''}page=${page + 1}`} className="btn-secondary text-xs">Volgende →</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
