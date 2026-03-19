import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const skip = (page - 1) * limit
  const now = new Date()

  let where: object

  // Statussen die nooit in de actieve werkwachtrij of review horen
  const EXCLUDED_FROM_ACTIVE = ['DUPLICATE', 'PAID'] as const

  if (status === 'DUPLICATE' || status === 'PAID') {
    // Expliciet filter voor afzonderlijke eindstatussen — inclusief verlopen
    where = { status: status as never }
  } else if (status) {
    // Specifiek statusfilter: toon alleen niet-verlopen records
    // REVIEW sluit DUPLICATE en PAID altijd uit
    where = {
      status: status as never,
      NOT: status === 'REVIEW'
        ? { status: { in: EXCLUDED_FROM_ACTIVE as never[] } }
        : undefined,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  } else {
    // Standaard: actieve werkitems — geen duplicaten/betaald, geen verlopen records
    where = {
      status: { notIn: EXCLUDED_FROM_ACTIVE as never[] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  }

  const [transactions, total] = await Promise.all([
    db.bankTransaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      skip,
      take: limit,
      include: {
        paymentLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    db.bankTransaction.count({ where }),
  ])

  return NextResponse.json({
    transactions,
    total,
    page,
    pages: Math.ceil(total / limit),
  })
}
