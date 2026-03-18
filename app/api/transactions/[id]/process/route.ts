import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { processTransaction } from '@/lib/processing/processor'

const schema = z.object({
  invoiceId: z.string().min(1).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Ongeldige invoer', details: parsed.error.flatten() }, { status: 400 })
  }

  const tx = await db.bankTransaction.findUnique({ where: { id: params.id } })
  if (!tx) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })

  const invoiceId = parsed.data.invoiceId ?? tx.matchedInvoiceId ?? null
  if (!invoiceId) {
    return NextResponse.json(
      { error: 'Geen factuur-ID opgegeven en geen match beschikbaar' },
      { status: 400 }
    )
  }

  if (tx.status === 'PROCESSED') {
    return NextResponse.json({ error: 'Al verwerkt' }, { status: 409 })
  }

  try {
    const result = await processTransaction(params.id, invoiceId)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
