import { db } from '@/lib/db'
import { processPayment } from '@/lib/rentmagic/client'
import { auditLog } from '@/lib/utils/audit'
import { checkDuplicate } from '@/lib/duplicate/detector'
import type { AutoDecision } from '@/lib/matching/engine'

/**
 * Verwerkt een transactie conform de beslissing van de matching engine.
 *
 * Regels:
 * - decision.postPayment = false → doe NIETS, log fout
 * - decision.postPayment = true  → POST payment
 * - decision.setLabel = true     → PATCH invoice label (alleen als saldo na betaling = 0)
 * - decision.setLabel = false    → label OVERGESLAGEN (deelbetaling of review)
 *
 * Fouttolerantic:
 * - Payment OK + label PATCH faalt → PARTIAL_SUCCESS, retry beschikbaar
 * - Payment faalt → status blijft PENDING, retry beschikbaar
 */
export async function processTransaction(
  transactionId: string,
  invoiceId: string,
  decision?: AutoDecision
): Promise<{ success: boolean; paymentSuccess: boolean; labelSuccess: boolean; error?: string }> {
  const tx = await db.bankTransaction.findUnique({ where: { id: transactionId } })
  if (!tx) throw new Error(`Transactie ${transactionId} niet gevonden`)

  if (tx.status === 'PROCESSED') {
    return { success: true, paymentSuccess: true, labelSuccess: true }
  }

  // ── Duplicate guard: laatste veiligheidscheck vlak vóór de API call ──
  // Controleert openAmount in de factuurcache + bestaande PaymentLogs.
  // Voorkomt dubbele boekingen zelfs als de status in de DB nog niet bijgewerkt is.
  const dupCheck = await checkDuplicate({
    invoiceId,
    amount: parseFloat(tx.amount.toString()),
  })

  if (dupCheck.isDuplicate) {
    await db.bankTransaction.update({
      where: { id: transactionId },
      data: { status: 'DUPLICATE', duplicateReason: dupCheck.reason },
    })
    await auditLog({
      action: 'DUPLICATE_BLOCKED',
      entityType: 'BankTransaction',
      entityId: transactionId,
      payload: { invoiceId, reason: dupCheck.reason },
      response: null,
      success: false,
      errorMsg: dupCheck.reason,
    })
    return {
      success: false,
      paymentSuccess: false,
      labelSuccess: false,
      error: `Geblokkeerd als duplicaat: ${dupCheck.reason}`,
    }
  }

  // Als er geen decision meegegeven is, haal de opgeslagen beslissing op uit de matchType
  // Gebruik de voorzichtige default: payment ja, label alleen als matchType aangeeft dat het volledig is
  const shouldSetLabel = decision
    ? decision.setLabel
    : tx.matchType === 'EXACT_FULL_PAYMENT'

  const amount = parseFloat(tx.amount.toString())

  await auditLog({
    action: 'PROCESS_START',
    entityType: 'BankTransaction',
    entityId: transactionId,
    payload: { invoiceId, amount, shouldSetLabel, scenario: tx.matchType },
    response: null,
    success: true,
  })

  // Voer de RentMagic calls uit
  // processPayment in client.ts respecteert shouldSetLabel via de derde parameter
  const result = await processPaymentWithDecision(
    transactionId,
    invoiceId,
    amount,
    tx.transactionDate,
    shouldSetLabel
  )

  // Bepaal nieuwe transactiestatus
  let newStatus: 'PROCESSED' | 'PARTIAL_SUCCESS' | 'PENDING'
  if (result.paymentSuccess && result.labelSuccess) {
    newStatus = 'PROCESSED'
  } else if (result.paymentSuccess) {
    // labelSuccess = false kan betekenen:
    // a) intentioneel overgeslagen (deelbetaling) → PARTIAL_SUCCESS
    // b) technische fout → PARTIAL_SUCCESS (retry)
    newStatus = 'PARTIAL_SUCCESS'
  } else {
    newStatus = 'PENDING' // payment mislukt, alles nog open
  }

  // Sla payment log op
  await db.paymentLog.create({
    data: {
      transactionId,
      invoiceId,
      amount: tx.amount,
      rentmagicPaymentId: result.paymentId,
      paymentStatus: result.paymentSuccess ? 'SUCCESS' : 'FAILED',
      labelStatus: !shouldSetLabel
        ? 'SKIPPED'
        : result.labelSuccess
        ? 'SUCCESS'
        : 'FAILED',
      paymentRequest: {
        InvoiceID: invoiceId,
        Amount: amount,
        TransactionDate: tx.transactionDate.toISOString().slice(0, 10),
      },
      errorMessage: result.error,
    },
  })

  await db.bankTransaction.update({
    where: { id: transactionId },
    data: {
      status: newStatus,
      matchedInvoiceId: invoiceId,
      // Verwerkte en deelbetalingen worden permanent bewaard (expiresAt = null)
      // Zo blijft de audit trail intact en wordt de record niet gecleanup'd
      ...(newStatus === 'PROCESSED' || newStatus === 'PARTIAL_SUCCESS'
        ? { expiresAt: null }
        : {}),
    },
  })

  await auditLog({
    action: 'PROCESS_DONE',
    entityType: 'BankTransaction',
    entityId: transactionId,
    payload: { invoiceId, newStatus, shouldSetLabel },
    response: { paymentSuccess: result.paymentSuccess, labelSuccess: result.labelSuccess },
    success: result.paymentSuccess,
    errorMsg: result.error,
  })

  return result
}

/**
 * Voert de RentMagic API calls uit met expliciete controle over label.
 */
async function processPaymentWithDecision(
  transactionId: string,
  invoiceId: string,
  amount: number,
  transactionDate: Date,
  shouldSetLabel: boolean
): Promise<{ success: boolean; paymentSuccess: boolean; labelSuccess: boolean; paymentId?: string; error?: string }> {
  const BASE_URL = process.env.RENTMAGIC_BASE_URL?.replace(/\/$/, '') ?? ''
  const API_KEY = process.env.RENTMAGIC_API_KEY ?? ''

  function rmUrl(path: string): string {
    const base = `${BASE_URL}${path}`
    if (process.env.RENTMAGIC_BEARER_TOKEN) return base
    return `${base}?token=${encodeURIComponent(API_KEY)}`
  }

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (process.env.RENTMAGIC_BEARER_TOKEN) h['Authorization'] = `Bearer ${process.env.RENTMAGIC_BEARER_TOKEN}`
    return h
  }

  // ── Stap 1: POST payment ──
  const paymentBody = {
    InvoiceID: invoiceId,
    Amount: amount,
    TransactionDate: transactionDate.toISOString().slice(0, 10),
  }

  let paymentOk = false
  let paymentId: string | undefined
  let paymentErr: string | undefined

  try {
    const res = await fetch(rmUrl('/api/v2/payments'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(paymentBody),
    })
    const body = await safeJson(res)

    await auditLog({
      action: 'RENTMAGIC_POST_PAYMENT',
      entityType: 'BankTransaction',
      entityId: transactionId,
      payload: paymentBody,
      response: body,
      success: res.ok,
      errorMsg: res.ok ? undefined : `HTTP ${res.status}`,
    })

    if (res.ok) {
      paymentOk = true
      const b = body as Record<string, unknown>
      paymentId = String(b?.ID ?? b?.PaymentID ?? b?.id ?? '') || undefined
    } else {
      paymentErr = `Payment POST mislukt: HTTP ${res.status}`
    }
  } catch (err) {
    paymentErr = err instanceof Error ? err.message : String(err)
    await auditLog({
      action: 'RENTMAGIC_POST_PAYMENT',
      entityType: 'BankTransaction',
      entityId: transactionId,
      payload: paymentBody,
      response: null,
      success: false,
      errorMsg: paymentErr,
    })
  }

  if (!paymentOk) {
    return { success: false, paymentSuccess: false, labelSuccess: false, error: paymentErr }
  }

  // ── Stap 2: PATCH label (alleen als beslissing het toestaat) ──
  if (!shouldSetLabel) {
    return { success: true, paymentSuccess: true, labelSuccess: false, paymentId }
  }

  const labelBody = { CustomFields: { CUST_Label: 'Betaald' } }
  let labelOk = false
  let labelErr: string | undefined

  try {
    const res = await fetch(rmUrl(`/api/v2/invoices/${invoiceId}`), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(labelBody),
    })
    const body = await safeJson(res)

    await auditLog({
      action: 'RENTMAGIC_PATCH_LABEL',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { transactionId, body: labelBody },
      response: body,
      success: res.ok,
      errorMsg: res.ok ? undefined : `HTTP ${res.status}`,
    })

    labelOk = res.ok
    if (!res.ok) labelErr = `Label PATCH mislukt: HTTP ${res.status}`
  } catch (err) {
    labelErr = err instanceof Error ? err.message : String(err)
    await auditLog({
      action: 'RENTMAGIC_PATCH_LABEL',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: labelBody,
      response: null,
      success: false,
      errorMsg: labelErr,
    })
  }

  return {
    success: labelOk,
    paymentSuccess: true,
    labelSuccess: labelOk,
    paymentId,
    error: labelErr,
  }
}

/**
 * Verwerkt één banktransactie tegen meerdere facturen tegelijk (MULTI_INVOICE_EXACT).
 *
 * Per factuur:
 *   - POST payment voor het openstaande bedrag van die factuur
 *   - PATCH label "Betaald" (want som === txAmount → elke factuur gaat naar €0)
 *   - Eigen PaymentLog
 *
 * Transactiestatus:
 *   - Alle betalingen + labels OK → PROCESSED
 *   - Minimaal één payment OK → PARTIAL_SUCCESS
 *   - Alles mislukt → PENDING
 */
export async function processMultipleInvoices(
  transactionId: string,
  invoiceIds: string[]
): Promise<{ success: boolean }> {
  const tx = await db.bankTransaction.findUnique({ where: { id: transactionId } })
  if (!tx) throw new Error(`Transactie ${transactionId} niet gevonden`)

  if (tx.status === 'PROCESSED') return { success: true }

  // Haal de openAmounts op uit de cache (per factuur het eigen bedrag boeken)
  const invoiceCacheRows = await db.invoiceCache.findMany({
    where: { invoiceId: { in: invoiceIds } },
  })
  const invoiceMap = new Map(invoiceCacheRows.map((i) => [i.invoiceId, i]))

  // Duplicate guard: als één factuur al betaald is in RM, de hele batch naar review
  for (const invoiceId of invoiceIds) {
    const cachedAmount = parseFloat(invoiceMap.get(invoiceId)?.openAmount?.toString() ?? '0')
    const dupCheck = await checkDuplicate({ invoiceId, amount: cachedAmount })
    if (dupCheck.isDuplicate) {
      await db.bankTransaction.update({
        where: { id: transactionId },
        data: { status: 'REVIEW', matchReason: `Multi-invoice geblokkeerd: ${dupCheck.reason}` },
      })
      await auditLog({
        action: 'DUPLICATE_BLOCKED',
        entityType: 'BankTransaction',
        entityId: transactionId,
        payload: { invoiceId, reason: dupCheck.reason },
        response: null,
        success: false,
        errorMsg: dupCheck.reason,
      })
      return { success: false }
    }
  }

  let allProcessed = true
  let anyPayment = false

  for (const invoiceId of invoiceIds) {
    const invoiceCacheRow = invoiceMap.get(invoiceId)
    if (!invoiceCacheRow) {
      allProcessed = false
      console.error(`[MultiProcess] Factuur ${invoiceId} niet gevonden in cache`)
      continue
    }

    const openAmount = parseFloat(invoiceCacheRow.openAmount.toString())

    const result = await processPaymentWithDecision(
      transactionId,
      invoiceId,
      openAmount,
      tx.transactionDate,
      true // label altijd zetten: elke factuur gaat exact naar €0
    )

    if (result.paymentSuccess) anyPayment = true
    if (!result.paymentSuccess || !result.labelSuccess) allProcessed = false

    await db.paymentLog.create({
      data: {
        transactionId,
        invoiceId,
        amount: openAmount,
        rentmagicPaymentId: result.paymentId,
        paymentStatus: result.paymentSuccess ? 'SUCCESS' : 'FAILED',
        labelStatus: result.paymentSuccess
          ? (result.labelSuccess ? 'SUCCESS' : 'FAILED')
          : 'FAILED',
        paymentRequest: {
          InvoiceID: invoiceId,
          Amount: openAmount,
          TransactionDate: tx.transactionDate.toISOString().slice(0, 10),
        },
        errorMessage: result.error,
      },
    })
  }

  const newStatus: 'PROCESSED' | 'PARTIAL_SUCCESS' | 'PENDING' =
    allProcessed && anyPayment ? 'PROCESSED'
    : anyPayment ? 'PARTIAL_SUCCESS'
    : 'PENDING'

  await db.bankTransaction.update({
    where: { id: transactionId },
    data: {
      status: newStatus,
      ...(newStatus === 'PROCESSED' || newStatus === 'PARTIAL_SUCCESS' ? { expiresAt: null } : {}),
    },
  })

  await auditLog({
    action: 'PROCESS_DONE',
    entityType: 'BankTransaction',
    entityId: transactionId,
    payload: { invoiceIds, newStatus },
    response: { allProcessed, anyPayment },
    success: allProcessed,
  })

  return { success: allProcessed }
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.clone().json() }
  catch { return { _raw: await res.text() } }
}
