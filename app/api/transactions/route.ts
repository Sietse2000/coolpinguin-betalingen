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

  if (status === 'DUPLICATE') {
    // Expliciet filter voor duplicaten — toon ze inclusief verlopen
    where = { status: 'DUPLICATE' }
  } else if (status) {
    // Specifiek statusfilter: toon alleen niet-verlopen records
    // REVIEW-filter sluit DUPLICATE altijd uit
    where = {
      status: status as never,
      NOT: status === 'REVIEW' ? { status: 'DUPLICATE' as never } : undefined,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  } else {
    // Standaard: actieve werkitems — geen duplicaten, geen verlopen records
    where = {
      status: { notIn: ['DUPLICATE'] as never[] },
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
