import { db } from '@/lib/db'
import { LogStatusBadge, ScenarioBadge } from '@/components/StatusBadge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ProcessedPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string }
}) {
  const filterStatus = searchParams.status
  const page = parseInt(searchParams.page ?? '1', 10)
  const limit = 50
  const skip = (page - 1) * limit

  const where = filterStatus
    ? { status: filterStatus as never }
    : { status: { in: ['PROCESSED', 'PARTIAL_SUCCESS'] as never[] } }

  const [transactions, total] = await Promise.all([
    db.bankTransaction.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      include: { paymentLogs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    db.bankTransaction.count({ where }),
  ])

  const pages = Math.ceil(total / limit)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">Verwerkte betalingen</h1>
          <p className="text-sm text-gray-500">{total} betalingen</p>
        </div>
        <div className="flex gap-2">
          {[
            { label: 'Alle',          href: '/processed',                        active: !filterStatus },
            { label: 'Volledig',      href: '/processed?status=PROCESSED',       active: filterStatus === 'PROCESSED' },
            { label: 'Deelbetalingen', href: '/processed?status=PARTIAL_SUCCESS', active: filterStatus === 'PARTIAL_SUCCESS' },
          ].map((f) => (
            <Link key={f.href} href={f.href}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                f.active ? 'bg-cp-dark text-white border-cp-dark' : 'bg-white text-gray-600 border-gray-300 hover:border-cp-blue'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Datum', 'Tegenpartij', 'Bedrag', 'Factuur', 'Scenario', 'Payment', 'Label', 'Opmerking', ''].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={9} className="td py-8 text-center text-gray-400">
                    Geen betalingen gevonden
                  </td>
                </tr>
              )}
              {transactions.map((tx) => {
                const log = tx.paymentLogs[0]
                return (
                  <tr key={tx.id} className={`hover:bg-gray-50 ${tx.status === 'PARTIAL_SUCCESS' ? 'bg-amber-50/40' : ''}`}>
                    <td className="td text-xs text-gray-500 whitespace-nowrap">
                      {tx.transactionDate.toLocaleDateString('nl-NL')}
                    </td>
                    <td className="td max-w-36 truncate font-medium">{tx.counterpartyName ?? '—'}</td>
                    <td className="td font-mono whitespace-nowrap">
                      € {parseFloat(tx.amount.toString()).toFixed(2)}
                    </td>
                    <td className="td font-mono text-xs text-cp-blue font-medium">
                      {tx.matchedInvoiceId ?? '—'}
                    </td>
                    <td className="td">
                      {tx.matchType ? <ScenarioBadge scenario={tx.matchType} /> : '—'}
                    </td>
                    <td className="td">
                      {log ? <LogStatusBadge status={log.paymentStatus as never} /> : '—'}
                    </td>
                    <td className="td">
                      {log ? (
                        <div>
                          <LogStatusBadge status={log.labelStatus as never} />
                          {log.labelStatus === 'SKIPPED' && (
                            <div className="text-xs text-gray-400 mt-0.5">Deelbetaling</div>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="td max-w-40 text-xs text-red-500 truncate">
                      {log?.errorMessage ?? ''}
                    </td>
                    <td className="td">
                      {tx.status === 'PARTIAL_SUCCESS' && log?.labelStatus === 'FAILED' && (
                        <RetryButton logId={log.id} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-400">pagina {page} van {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link href={`/processed?page=${page-1}${filterStatus ? `&status=${filterStatus}` : ''}`} className="btn-secondary text-xs">← Vorige</Link>}
              {page < pages && <Link href={`/processed?page=${page+1}${filterStatus ? `&status=${filterStatus}` : ''}`} className="btn-secondary text-xs">Volgende →</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RetryButton({ logId }: { logId: string }) {
  return (
    <form action={`/api/payments/${logId}/retry`} method="POST">
      <button type="submit" className="btn-ghost text-xs px-2 py-1">
        Retry label
      </button>
    </form>
  )
}
