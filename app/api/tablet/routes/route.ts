import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deriveStopKey } from '@/lib/ritplanning/stop-key'

// GET /api/tablet/routes?date=YYYY-MM-DD
// Geeft de routes + stop-tracking statussen voor één dag
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ routes: [] })

  try {
    // Zoek een RitplanningWeek waarvan het 7-daagse venster de gevraagde datum omvat.
    // weekStart kan elke dag zijn (de dag waarop de planner de data laadde).
    const allPlans = await db.ritplanningWeek.findMany({
      orderBy: { weekStart: 'desc' },
      take: 10,
    })

    // Selecteer het plan waarvan weekStart <= date <= weekStart + 6 dagen
    const plan = allPlans.find((p) => {
      const start = new Date(p.weekStart)
      const end = new Date(start); end.setDate(start.getDate() + 6)
      const target = new Date(date)
      return target >= start && target <= end
    }) ?? null

    const weekStart = plan?.weekStart ?? date

    const trackingRows = plan
      ? await db.stopTracking.findMany({ where: { weekStart: plan.weekStart } })
      : []

    if (!plan) return NextResponse.json({ routes: [], weekStart })

    // Bouw tracking lookup: stopKey → tracking row
    const trackingByKey: Record<string, typeof trackingRows[0]> = {}
    for (const t of trackingRows) {
      trackingByKey[t.stopKey] = t
    }

    // Filter routes op de gevraagde datum en voeg stopKey toe aan elke stop
    type SavedRoute = {
      vehicleId: string | null
      vehicleName: string
      assignedVehicleName: string
      hasTrailer: boolean
      workStart: number
      workEnd: number
      stops: Array<{
        rentmagicOrderId?: string
        calendarEventId?: string
        customerName: string
        address: string
        date: string
        timeWindowStart?: string
        timeWindowEnd?: string
        durationMin?: number
        type: string
        [key: string]: unknown
      }>
    }

    const savedRoutes = plan.routesJson as SavedRoute[]
    const routes = savedRoutes.map((route) => {
      const vid = route.vehicleId ?? route.vehicleName
      const dayStops = route.stops
        .filter((s) => s.date === date)
        .map((s, idx) => {
          const stopKey = deriveStopKey(s, vid, date, idx)
          return { ...s, stopKey, tracking: trackingByKey[stopKey] ?? null }
        })
      return { ...route, stops: dayStops }
    }).filter((r) => r.stops.length > 0)

    return NextResponse.json({ routes, weekStart })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
