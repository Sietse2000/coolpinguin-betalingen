import { db } from '@/lib/db'
import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import SyncButton from '@/components/SyncButton'

const DevResetButton = process.env.NODE_ENV === 'development'
  ? dynamicImport(() => import('@/components/DevResetButton'))
  : null

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const now = new Date()
  // Actieve items: niet verlopen en geen duplicaten
  const activeWhere = {
    status: { notIn: ['DUPLICATE'] as never[] },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }

  const [counts, recentLogs, partialCount, dupCount] = await Promise.all([
    db.bankTransaction.groupBy({
      by: ['status'],
      _count: { status: true },
      where: activeWhere,
    }),
    db.paymentLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: {
        transaction: { select: { counterpartyName: true, amount: true } },
      },
    }),
    db.bankTransaction.count({
      where: {
        status: 'PARTIAL_SUCCESS',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.bankTransaction.count({ where: { status: 'DUPLICATE' } }),
  ])

  const c = Object.fromEntries(counts.map((x) => [x.status, x._count.status]))
  const reviewCount = c['REVIEW'] ?? 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Overzicht van alle bankbetalingen</p>
        </div>
        <div className="flex items-center gap-3">
          {DevResetButton && <DevResetButton />}
          <SyncButton />
          <div className="flex flex-col items-end gap-1">
            <Link href="/upload" className="btn-primary text-base px-5 py-2.5">
              Stap 2 — Bankbestand uploaden
            </Link>
          </div>
        </div>
      </div>

      {/* Urgente melding: handmatige controle */}
      {reviewCount > 0 && (
        <Link href="/review" className="block mb-5">
          <div className="flex items-center justify-between p-4 rounded-lg border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚑</span>
              <div>
                <div className="font-medium text-cp-dark">
                  {reviewCount} transactie{reviewCount !== 1 ? 's' : ''} wacht{reviewCount === 1 ? '' : 'en'} op handmatige controle
                </div>
                <div className="text-sm text-amber-700">
                  Deze worden nooit automatisch verwerkt — klik om te beoordelen
                </div>
              </div>
            </div>
            <span className="text-cp-blue font-medium text-sm">Bekijken →</span>
          </div>
        </Link>
      )}

      {/* Duplicaten info */}
      {dupCount > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-between text-sm">
          <span className="text-purple-700">
            <strong>{dupCount}</strong> transactie{dupCount !== 1 ? 's' : ''} herkend als duplicaat — factuur al betaald of al eerder geboekt
          </span>
          <Link href="/transactions?status=DUPLICATE" className="text-purple-700 underline text-sm">
            Bekijken
          </Link>
        </div>
      )}

      {/* PARTIAL_SUCCESS waarschuwing */}
      {partialCount > 0 && (
        <div className="mb-5 alert-warning flex items-center justify-between">
          <span>
            <strong>{partialCount}</strong> deelbetaling{partialCount !== 1 ? 'en' : ''}: payment geboekt, label nog niet gezet
          </span>
          <Link href="/processed?status=PARTIAL_SUCCESS" className="text-amber-800 underline text-sm">
            Bekijken
          </Link>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Controle nodig',    value: c['REVIEW'] ?? 0,          href: '/review',                            color: 'border-amber-400 bg-amber-50',   text: 'text-amber-800' },
          { label: 'Volledig verwerkt', value: c['PROCESSED'] ?? 0,        href: '/processed',                         color: 'border-green-400 bg-green-50',   text: 'text-green-800' },
          { label: 'Deelbetalingen',    value: c['PARTIAL_SUCCESS'] ?? 0,  href: '/processed?status=PARTIAL_SUCCESS',  color: 'border-blue-300 bg-cp-blue-light', text: 'text-cp-dark' },
          { label: 'In behandeling',    value: c['PENDING'] ?? 0,          href: '/transactions?status=PENDING',       color: 'border-gray-300 bg-gray-50',     text: 'text-gray-700' },
          { label: 'Afgewezen',         value: c['REJECTED'] ?? 0,         href: '/transactions?status=REJECTED',      color: 'border-red-300 bg-red-50',       text: 'text-red-700' },
          { label: 'Duplicaten',        value: c['DUPLICATE'] ?? 0,        href: '/transactions?status=DUPLICATE',     color: 'border-gray-200 bg-gray-50',     text: 'text-gray-500' },
        ].map((s) => (
          <Link key={s.label} href={s.href} className={`card p-5 border-l-4 ${s.color} hover:shadow-md transition-shadow`}>
            <div className={`text-3xl font-medium mb-1 ${s.text}`}>{s.value}</div>
            <div className="text-sm text-gray-600">{s.label}</div>
          </Link>
        ))}
      </div>

      {/* Recente verwerking */}
      <div className="card">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium text-cp-dark">Recente betalingen</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {recentLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Nog geen betalingen verwerkt</p>
          ) : (
            recentLogs.map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-sm font-medium text-cp-dark">
                    {log.transaction.counterpartyName ?? '—'}
                  </div>
                  <div className="text-sm font-mono text-gray-600">
                    € {parseFloat(log.amount.toString()).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400">→ {log.invoiceId}</div>
                </div>
                <div className="flex gap-2 items-center text-xs">
                  <span className={log.paymentStatus === 'SUCCESS' ? 'text-green-600' : 'text-red-500'}>
                    Payment: {log.paymentStatus}
                  </span>
                  <span className="text-gray-300">|</span>
                  <span className={
                    log.labelStatus === 'SUCCESS' ? 'text-green-600' :
                    log.labelStatus === 'SKIPPED' ? 'text-gray-400' :
                    'text-orange-500'
                  }>
                    Label: {log.labelStatus}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
