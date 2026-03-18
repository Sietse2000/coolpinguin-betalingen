import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processTransaction } from '@/lib/processing/processor'

/**
 * Retry een PARTIAL_SUCCESS transactie.
 * Alleen de label-patch hoeft opnieuw als payment al gelukt is.
 *
 * Aanname: als paymentStatus = SUCCESS en labelStatus = FAILED,
 * probeer dan alleen de PATCH opnieuw.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const log = await db.paymentLog.findUnique({
    where: { id: params.id },
    include: { transaction: true },
  })

  if (!log) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })

  if (log.paymentStatus === 'SUCCESS' && log.labelStatus === 'SUCCESS') {
    return NextResponse.json({ error: 'Al volledig verwerkt' }, { status: 409 })
  }

  // Update retry count
  await db.paymentLog.update({
    where: { id: params.id },
    data: { retryCount: { increment: 1 } },
  })

  try {
    let result
    if (log.paymentStatus === 'SUCCESS' && log.labelStatus === 'FAILED') {
      // Alleen label opnieuw proberen
      const { patchInvoiceLabel } = await import('@/lib/rentmagic/label')
      const labelOk = await patchInvoiceLabel(log.invoiceId, log.transactionId)

      await db.paymentLog.update({
        where: { id: params.id },
        data: { labelStatus: labelOk ? 'SUCCESS' : 'FAILED' },
      })

      if (labelOk) {
        await db.bankTransaction.update({
          where: { id: log.transactionId },
          data: { status: 'PROCESSED' },
        })
      }

      result = { paymentSuccess: true, labelSuccess: labelOk }
    } else {
      // Volledige retry
      result = await processTransaction(log.transactionId, log.invoiceId)
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
