import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditLog } from '@/lib/utils/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const tx = await db.bankTransaction.findUnique({ where: { id: params.id } })
  if (!tx) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })

  if (tx.status === 'PROCESSED') {
    return NextResponse.json({ error: 'Verwerkte transacties kunnen niet afgewezen worden' }, { status: 409 })
  }

  await db.bankTransaction.update({
    where: { id: params.id },
    data: { status: 'REJECTED' },
  })

  await auditLog({
    action: 'REJECT_TRANSACTION',
    entityType: 'BankTransaction',
    entityId: params.id,
    payload: { reason },
    response: null,
    success: true,
  })

  return NextResponse.json({ success: true })
}
