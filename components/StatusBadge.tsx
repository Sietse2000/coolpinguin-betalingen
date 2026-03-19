import type { TransactionStatus, LogStatus } from '@/types'

const TX_COLORS: Record<TransactionStatus, string> = {
  PENDING:          'bg-gray-100 text-gray-600',
  AUTO_MATCHED:     'bg-blue-100 text-blue-700',
  REVIEW:           'bg-amber-100 text-amber-800',
  PROCESSED:        'bg-green-100 text-green-700',
  PARTIAL_SUCCESS:  'bg-orange-100 text-orange-700',
  REJECTED:         'bg-red-100 text-red-700',
  DUPLICATE:        'bg-purple-100 text-purple-700',
  PAID:             'bg-teal-100 text-teal-700',
}

const TX_LABELS: Record<TransactionStatus, string> = {
  PENDING:          'In behandeling',
  AUTO_MATCHED:     'Auto verwerkt',
  REVIEW:           'Controle nodig',
  PROCESSED:        'Volledig verwerkt',
  PARTIAL_SUCCESS:  'Deelbetaling',
  REJECTED:         'Afgewezen',
  DUPLICATE:        'Duplicaat',
  PAID:             'Betaald',
}

const LOG_COLORS: Record<LogStatus, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  FAILED:  'bg-red-100 text-red-700',
  PENDING: 'bg-gray-100 text-gray-600',
  SKIPPED: 'bg-gray-100 text-gray-500',
}

const LOG_LABELS: Record<LogStatus, string> = {
  SUCCESS: 'OK',
  FAILED:  'Mislukt',
  PENDING: 'Wacht',
  SKIPPED: 'Overgeslagen',
}

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TX_COLORS[status]}`}>
      {TX_LABELS[status]}
    </span>
  )
}

export function LogStatusBadge({ status }: { status: LogStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${LOG_COLORS[status]}`}>
      {LOG_LABELS[status]}
    </span>
  )
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const color =
    pct >= 95 ? 'bg-green-100 text-green-700' :
    pct >= 75 ? 'bg-amber-100 text-amber-800' :
                'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {pct}%
    </span>
  )
}

export function ScenarioBadge({ scenario }: { scenario: string }) {
  const map: Record<string, { label: string; color: string }> = {
    EXACT_FULL_PAYMENT:    { label: 'Exact + volledig',   color: 'bg-green-100 text-green-700' },
    EXACT_PARTIAL_PAYMENT: { label: 'Deelbetaling',       color: 'bg-blue-100 text-blue-700' },
    EXACT_OVERPAYMENT:     { label: 'Te veel betaald',    color: 'bg-red-100 text-red-700' },
    LAST4_EXACT_UNIQUE:    { label: 'Laatste 4 cijfers',  color: 'bg-amber-100 text-amber-800' },
    AMOUNT_NAME_MATCH:     { label: 'Bedrag + naam',      color: 'bg-amber-100 text-amber-800' },
    AMOUNT_ONLY:           { label: 'Alleen bedrag',      color: 'bg-gray-100 text-gray-600' },
    MULTIPLE_MATCHES:      { label: 'Meerdere matches',   color: 'bg-orange-100 text-orange-700' },
    NO_MATCH:              { label: 'Geen match',         color: 'bg-gray-100 text-gray-500' },
    DEBIT_TRANSACTION:     { label: 'Uitgaand',           color: 'bg-gray-100 text-gray-400' },
    MANUAL:                { label: 'Handmatig',          color: 'bg-purple-100 text-purple-700' },
  }

  const entry = map[scenario] ?? { label: scenario, color: 'bg-gray-100 text-gray-600' }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${entry.color}`}>
      {entry.label}
    </span>
  )
}
