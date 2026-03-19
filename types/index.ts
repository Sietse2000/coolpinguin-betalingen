export type TransactionStatus =
  | 'PENDING'
  | 'AUTO_MATCHED'
  | 'REVIEW'
  | 'PROCESSED'
  | 'PARTIAL_SUCCESS'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'PAID'

export type LogStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'SKIPPED'

export type CreditDebit = 'CRDT' | 'DBIT'

export type FileType = 'CAMT053' | 'MT940'

export type MatchType =
  | 'EXACT_FULL_PAYMENT'
  | 'EXACT_PARTIAL_PAYMENT'
  | 'EXACT_OVERPAYMENT'
  | 'LAST4_EXACT_UNIQUE'
  | 'AMOUNT_NAME_MATCH'
  | 'AMOUNT_ONLY'
  | 'MULTIPLE_MATCHES'
  | 'NO_MATCH'
  | 'DEBIT_TRANSACTION'
  | 'MANUAL'

// Ruwe transactie zoals geparst uit het bankbestand
export interface ParsedTransaction {
  hash: string
  bankReference?: string
  transactionDate: Date
  valueDate?: Date
  amount: number
  currency: string
  creditDebit: CreditDebit
  counterpartyName?: string
  counterpartyIban?: string
  description?: string
  rawData: string
}

// Een match-suggestie van de matching engine
export interface MatchResult {
  invoiceId: string
  invoiceAmount: number
  openAmount: number
  customerName?: string
  confidence: number
  matchType: MatchType
  reason: string
}

// Resultaat van een verwerkingspoging naar RentMagic
export interface ProcessResult {
  success: boolean
  paymentSuccess: boolean
  labelSuccess: boolean
  paymentId?: string
  error?: string
}

// API response types
export interface ApiError {
  error: string
  details?: unknown
}

export interface TransactionWithLogs {
  id: string
  hash: string
  transactionDate: string
  amount: string
  currency: string
  creditDebit: CreditDebit
  counterpartyName: string | null
  counterpartyIban: string | null
  description: string | null
  status: TransactionStatus
  matchedInvoiceId: string | null
  confidence: string | null
  matchType: string | null
  matchReason: string | null
  createdAt: string
  paymentLogs: PaymentLogEntry[]
}

export interface PaymentLogEntry {
  id: string
  invoiceId: string
  amount: string
  paymentStatus: LogStatus
  labelStatus: LogStatus
  errorMessage: string | null
  retryCount: number
  createdAt: string
}

export interface InvoiceCacheEntry {
  id: string
  invoiceId: string
  customerId: string | null
  customerName: string | null
  totalAmount: string
  openAmount: string
  invoiceDate: string | null
  dueDate: string | null
  status: string | null
  syncedAt: string
}
