import { db } from '@/lib/db'

const AMOUNT_EPSILON = 0.005

export interface DuplicateCheck {
  isDuplicate: boolean
  /** 'RM' = geblokkeerd op basis van RentMagic data (bron van waarheid) */
  source?: 'RM'
  reason: string
}

/**
 * Controleer of een transactie al verwerkt is in RentMagic.
 *
 * RentMagic is de bron van waarheid. Twee harde blokkades:
 *   1. openAmount <= 0 in de factuurcache → factuur al volledig betaald in RM
 *   2. Succesvolle PaymentLog voor dezelfde factuur + bedrag → wij hebben al geboekt
 *
 * Lokale transactie-hash wordt NIET gebruikt als blokkade. Hash-dedup
 * bij upload (upload route) zorgt al dat dubbele imports niet binnenkomen.
 * De hash hier gebruiken zou de transactie op zijn eigen hash laten blokkeren.
 */
export async function checkDuplicate(params: {
  invoiceId: string
  amount: number
}): Promise<DuplicateCheck> {
  const { invoiceId, amount } = params

  // ── Check 1: Factuur heeft geen openstaand saldo meer (RM-cache) ──
  const invoice = await db.invoiceCache.findUnique({
    where: { invoiceId },
    select: { openAmount: true },
  })

  if (invoice) {
    const open = parseFloat(invoice.openAmount.toString())
    if (open <= AMOUNT_EPSILON) {
      return {
        isDuplicate: true,
        source: 'RM',
        reason: `Factuur ${invoiceId} heeft geen openstaand saldo (€ ${open.toFixed(2)}) — al betaald in RentMagic`,
      }
    }
  }

  // ── Check 2: Succesvolle PaymentLog voor dezelfde factuur + bedrag ──
  // Betekent: wij hebben al een payment naar RM gestuurd voor dit bedrag.
  const existingPayment = await db.paymentLog.findFirst({
    where: {
      invoiceId,
      paymentStatus: 'SUCCESS',
      amount: {
        gte: amount - AMOUNT_EPSILON,
        lte: amount + AMOUNT_EPSILON,
      },
    },
    select: { id: true, createdAt: true },
  })

  if (existingPayment) {
    return {
      isDuplicate: true,
      source: 'RM',
      reason: `Payment van € ${amount.toFixed(2)} op factuur ${invoiceId} al eerder naar RentMagic gestuurd (${existingPayment.createdAt.toLocaleDateString('nl-NL')})`,
    }
  }

  return { isDuplicate: false, reason: '' }
}

/**
 * Controleer bij upload of een factuur al volledig betaald is volgens de cache.
 * Gebruikt alleen de InvoiceCache — geen extra API calls.
 * Lokale transactiehistorie telt NIET mee: alleen RM-saldo is leidend.
 */
export function checkDuplicateFromCache(
  invoiceId: string,
  amount: number,
  invoices: { invoiceId: string; openAmount: string }[]
): DuplicateCheck {
  const invoice = invoices.find((i) => i.invoiceId === invoiceId)
  if (!invoice) return { isDuplicate: false, reason: '' }

  const open = parseFloat(invoice.openAmount)
  if (open <= AMOUNT_EPSILON) {
    return {
      isDuplicate: true,
      source: 'RM',
      reason: `Factuur ${invoiceId} heeft geen openstaand saldo (€ ${open.toFixed(2)}) — al betaald in RentMagic`,
    }
  }

  // Extra: als het betaalbedrag groter is dan het openstaande saldo, geen harde blokkade
  // maar dit is een signaal voor de matching engine (EXACT_OVERPAYMENT → review).
  void amount

  return { isDuplicate: false, reason: '' }
}
