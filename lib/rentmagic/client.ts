import { auditLog } from '@/lib/utils/audit'
import type { ProcessResult } from '@/types'

const BASE_URL = process.env.RENTMAGIC_BASE_URL?.replace(/\/$/, '') ?? ''
const API_KEY = process.env.RENTMAGIC_API_KEY ?? ''

if (!BASE_URL && process.env.NODE_ENV !== 'test') {
  console.warn('[RentMagic] RENTMAGIC_BASE_URL is niet ingesteld')
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  // RentMagic authenticatie gaat via ?token= query parameter (zie URL's hieronder)
  // Bearer token optie behouden voor eventuele toekomstige OAuth flow
  if (process.env.RENTMAGIC_BEARER_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.RENTMAGIC_BEARER_TOKEN}`
  }

  return headers
}

/**
 * Haalt ALLE facturen op uit RentMagic (geen statusfilter).
 * Filtering op openstaand saldo gebeurt in de sync route (openAmount > 0).
 */
export async function fetchOpenInvoices(): Promise<RentMagicInvoice[]> {
  // Geen ?Status=Open filter: facturen kunnen openstaand saldo hebben met een andere status
  // RentMagic verwacht de API key als ?token= query parameter
  const url = `${BASE_URL}/api/v2/invoices?token=${encodeURIComponent(API_KEY)}`

  console.log('[RentMagic] Ophalen alle facturen:', url.replace(API_KEY, '***'))

  const res = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
    // Geen cache: altijd verse data
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`RentMagic invoices GET failed: ${res.status} ${body}`)
  }

  const rawText = await res.text()
  console.log('[RentMagic] Response status:', res.status)
  console.log('[RentMagic] Response preview:', rawText.slice(0, 500))

  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    throw new Error(`RentMagic response is geen geldige JSON: ${rawText.slice(0, 200)}`)
  }

  // Ondersteun meerdere response-vormen
  let invoices: RentMagicInvoice[] = []
  if (Array.isArray(data)) {
    invoices = data
  } else if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    const candidate = d['Collection'] ?? d['Items'] ?? d['invoices'] ?? d['data'] ?? d['Invoices']
    if (Array.isArray(candidate)) {
      invoices = candidate as RentMagicInvoice[]
    } else {
      console.log('[RentMagic] Onbekende response-structuur, keys:', Object.keys(d).join(', '))
    }
  }

  console.log(`[RentMagic] Facturen na mapping: ${invoices.length}`)
  if (invoices.length > 0) {
    console.log('[RentMagic] Keys eerste factuur:', Object.keys(invoices[0] as object).join(', '))
    console.log('[RentMagic] Eerste factuur (sample):', JSON.stringify(invoices[0]))
  }

  return invoices
}

/**
 * Registreert een betaling bij RentMagic.
 *
 * Fouttolerante flow:
 * 1. POST /api/v2/payments → als dit faalt, stop en log
 * 2. PATCH /api/v2/invoices/{id} met CUST_Label = "Betaald"
 *    → als stap 1 lukt maar dit faalt: markeer als PARTIAL_SUCCESS
 *
 * Returns ProcessResult met exacte status per stap.
 */
export async function processPayment(
  transactionId: string,
  invoiceId: string,
  amount: number,
  transactionDate: Date
): Promise<ProcessResult> {
  const paymentBody = {
    InvoiceID: invoiceId,
    Amount: amount,
    TransactionDate: transactionDate.toISOString().slice(0, 10),
  }

  // === Stap 1: Payment aanmaken ===
  let paymentResponse: unknown
  let rentmagicPaymentId: string | undefined

  try {
    const payRes = await fetch(`${BASE_URL}/api/v2/payments?token=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(paymentBody),
    })

    paymentResponse = await safeJson(payRes)

    await auditLog({
      action: 'CREATE_PAYMENT',
      entityType: 'BankTransaction',
      entityId: transactionId,
      payload: { invoiceId, amount, transactionDate, body: paymentBody },
      response: paymentResponse,
      success: payRes.ok,
      errorMsg: payRes.ok ? undefined : `HTTP ${payRes.status}`,
    })

    if (!payRes.ok) {
      return {
        success: false,
        paymentSuccess: false,
        labelSuccess: false,
        error: `Payment POST mislukt: HTTP ${payRes.status}`,
      }
    }

    // Probeer payment ID te extraheren
    const pr = paymentResponse as Record<string, unknown>
    rentmagicPaymentId =
      String(pr?.ID ?? pr?.PaymentID ?? pr?.id ?? '')  || undefined

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditLog({
      action: 'CREATE_PAYMENT',
      entityType: 'BankTransaction',
      entityId: transactionId,
      payload: paymentBody,
      response: null,
      success: false,
      errorMsg: msg,
    })
    return { success: false, paymentSuccess: false, labelSuccess: false, error: msg }
  }

  // === Stap 2: Label updaten ===
  const labelBody = {
    CustomFields: {
      CUST_Label: 'Betaald',
    },
  }

  let labelSuccess = false
  let labelResponse: unknown
  let labelError: string | undefined

  try {
    const labelRes = await fetch(`${BASE_URL}/api/v2/invoices/${invoiceId}?token=${encodeURIComponent(API_KEY)}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(labelBody),
    })

    labelResponse = await safeJson(labelRes)
    labelSuccess = labelRes.ok

    await auditLog({
      action: 'PATCH_INVOICE_LABEL',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { transactionId, body: labelBody },
      response: labelResponse,
      success: labelRes.ok,
      errorMsg: labelRes.ok ? undefined : `HTTP ${labelRes.status}`,
    })

    if (!labelRes.ok) {
      labelError = `Label PATCH mislukt: HTTP ${labelRes.status}`
    }
  } catch (err) {
    labelError = err instanceof Error ? err.message : String(err)
    await auditLog({
      action: 'PATCH_INVOICE_LABEL',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: labelBody,
      response: null,
      success: false,
      errorMsg: labelError,
    })
  }

  return {
    success: labelSuccess,
    paymentSuccess: true,
    labelSuccess,
    paymentId: rentmagicPaymentId,
    error: labelError,
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json()
  } catch {
    return { _raw: await res.text() }
  }
}

// Type voor RentMagic factuur response
export interface RentMagicInvoice {
  InvoiceID?: string
  ID?: string
  CustomerID?: string
  CustomerName?: string
  TotalAmount?: number
  /** Openstaand saldo — RentMagic gebruikt soms 'Balance', soms 'OpenAmount' */
  Balance?: number
  OpenAmount?: number
  InvoiceDate?: string
  DueDate?: string
  Status?: string
  [key: string]: unknown
}
