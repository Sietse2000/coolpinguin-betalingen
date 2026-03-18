import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const skip = (page - 1) * limit

  const [logs, total] = await Promise.all([
    db.paymentLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        transaction: {
          select: {
            transactionDate: true,
            counterpartyName: true,
            description: true,
            amount: true,
            currency: true,
          },
        },
      },
    }),
    db.paymentLog.count(),
  ])

  return NextResponse.json({ logs, total, page, pages: Math.ceil(total / limit) })
}
