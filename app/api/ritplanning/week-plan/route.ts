import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/ritplanning/week-plan?weekStart=YYYY-MM-DD
// Zoekt eerst exact op weekStart; als niets gevonden, zoek flexibel naar het plan
// dat de opgegeven datum omvat (net als de tablet-routes API).
export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ plan: null })

  try {
    // Stap 1: exacte match
    const exact = await db.ritplanningWeek.findUnique({ where: { weekStart } })
    if (exact) return NextResponse.json({ plan: exact })

    // Stap 2: flexibele match — vind plan waarvan 7-daags venster overlapt met de gevraagde week
    // (plan kan midden in de week zijn opgeslagen, bijv. weekStart=donderdag terwijl dashboard vraagt om maandag)
    const allPlans = await db.ritplanningWeek.findMany({
      orderBy: { weekStart: 'desc' },
      take: 10,
    })
    const reqStart = new Date(weekStart)
    const reqEnd = new Date(reqStart); reqEnd.setDate(reqStart.getDate() + 6)
    const plan = allPlans.find((p) => {
      const planStart = new Date(p.weekStart)
      const planEnd = new Date(planStart); planEnd.setDate(planStart.getDate() + 6)
      // Overlap: planStart <= reqEnd AND planEnd >= reqStart
      return planStart <= reqEnd && planEnd >= reqStart
    }) ?? null

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
