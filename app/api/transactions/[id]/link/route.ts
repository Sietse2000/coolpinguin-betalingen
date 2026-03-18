import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { auditLog } from '@/lib/utils/audit'

const schema = z.object({
  invoiceId: z.string().min(1),
  notes: z.string().optional(),
})

/**
 * Koppel een transactie handmatig aan een factuur.
 * Stelt de matchedInvoiceId in en markeert als REVIEW (klaar voor goedkeuring).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'invoiceId verplicht' }, { status: 400 })
  }

  const tx = await db.bankTransaction.findUnique({ where: { id: params.id } })
  if (!tx) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })

  if (tx.status === 'PROCESSED') {
    return NextResponse.json({ error: 'Al verwerkt' }, { status: 409 })
  }

  // Valideer dat de factuur bestaat in de cache
  const invoice = await db.invoiceCache.findUnique({
    where: { invoiceId: parsed.data.invoiceId },
  })

  if (!invoice) {
    return NextResponse.json(
      { error: `Factuur ${parsed.data.invoiceId} niet gevonden in cache. Sync eerst de facturen.` },
      { status: 404 }
    )
  }

  await db.bankTransaction.update({
    where: { id: params.id },
    data: {
      matchedInvoiceId: parsed.data.invoiceId,
      status: 'REVIEW',
      matchType: 'MANUAL',
      matchReason: `Handmatig gekoppeld${parsed.data.notes ? ': ' + parsed.data.notes : ''}`,
      confidence: 1.0,
    },
  })

  await auditLog({
    action: 'MANUAL_LINK',
    entityType: 'BankTransaction',
    entityId: params.id,
    payload: { invoiceId: parsed.data.invoiceId, notes: parsed.data.notes },
    response: null,
    success: true,
  })

  return NextResponse.json({ success: true, invoiceId: parsed.data.invoiceId })
}
