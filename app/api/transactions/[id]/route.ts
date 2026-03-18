import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runMatchingEngine } from '@/lib/matching/engine'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const tx = await db.bankTransaction.findUnique({
    where: { id: params.id },
    include: { paymentLogs: { orderBy: { createdAt: 'desc' } } },
  })

  if (!tx) {
    return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
  }

  // Herbereken matches voor actuele suggesties
  const invoices = await db.invoiceCache.findMany()
  const matchResult = runMatchingEngine(
    {
      amount: parseFloat(tx.amount.toString()),
      creditDebit: tx.creditDebit,
      counterpartyName: tx.counterpartyName,
      description: tx.description,
      bankReference: tx.bankReference,
      transactionDate: tx.transactionDate,
    },
    invoices
  )

  return NextResponse.json({ transaction: tx, matches: matchResult.suggestions })
}
