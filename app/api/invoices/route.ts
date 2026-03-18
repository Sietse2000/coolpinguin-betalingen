import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const search = searchParams.get('q')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const skip = (page - 1) * limit

  const where = search
    ? {
        OR: [
          { invoiceId: { contains: search, mode: 'insensitive' as const } },
          { customerName: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {}

  const [invoices, total, syncedAt] = await Promise.all([
    db.invoiceCache.findMany({
      where,
      orderBy: { invoiceId: 'asc' },
      skip,
      take: limit,
    }),
    db.invoiceCache.count({ where }),
    db.invoiceCache.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
  ])

  return NextResponse.json({
    invoices,
    total,
    page,
    pages: Math.ceil(total / limit),
    lastSync: syncedAt?.syncedAt ?? null,
  })
}
