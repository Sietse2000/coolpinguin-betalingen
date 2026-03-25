import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/ritplanning/week-plan?weekStart=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ plan: null })

  try {
    const plan = await db.ritplanningWeek.findUnique({ where: { weekStart } })
    return NextResponse.json({ plan })
  } catch {
    return NextResponse.json({ plan: null })
  }
}

// PUT /api/ritplanning/week-plan — sla planning op (upsert)
export async function PUT(req: NextRequest) {
  const { weekStart, routesJson, knownSourceStops } = await req.json()
  if (!weekStart) return NextResponse.json({ ok: false }, { status: 400 })

  try {
    await db.ritplanningWeek.upsert({
      where: { weekStart },
      create: { weekStart, routesJson, knownSourceStops },
      update: { routesJson, knownSourceStops },
    })

    // Verwijder weken ouder dan 3 weken (cleanup)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 21)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    await db.ritplanningWeek.deleteMany({ where: { weekStart: { lt: cutoffStr } } })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
