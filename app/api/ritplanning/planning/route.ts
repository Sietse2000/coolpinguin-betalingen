import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/ritplanning/planning?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date')
  if (!dateParam) return NextResponse.json({ error: 'date verplicht' }, { status: 400 })

  const date = new Date(dateParam)

  const planning = await db.planningDay.findUnique({
    where: { date },
    include: {
      routes: {
        include: {
          vehicle: true,
          stops: { orderBy: { sortOrder: 'asc' } },
        },
      },
    },
  })

  return NextResponse.json({ planning })
}

// POST /api/ritplanning/planning — sla bevestigde planning op (routes + stops)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { date, routes } = body as {
    date: string
    routes: Array<{
      vehicleId: string | null
      vehicleName: string
      stops: Array<{
        type: 'PICKUP' | 'DELIVERY' | 'CALENDAR'
        customerName?: string
        address?: string
        rentmagicOrderId?: string
        calendarEventId?: string
        calendarTitle?: string
        timeWindowStart?: string
        timeWindowEnd?: string
        sortOrder: number
      }>
    }>
  }

  if (!date) return NextResponse.json({ error: 'date verplicht' }, { status: 400 })

  const parsedDate = new Date(date)

  // Maak of hergebruik planningsdag
  const planningDay = await db.planningDay.upsert({
    where: { date: parsedDate },
    create: { date: parsedDate, status: 'CONFIRMED' },
    update: { status: 'CONFIRMED' },
  })

  // Verwijder bestaande stops en routes (schone lei)
  await db.stop.deleteMany({ where: { planningDayId: planningDay.id } })
  await db.route.deleteMany({ where: { planningDayId: planningDay.id } })

  // Maak routes aan met hun stops
  for (const routeData of routes ?? []) {
    let vehicleId = routeData.vehicleId

    // Geen vehicleId → maak automatisch een voertuig aan
    if (!vehicleId) {
      const vehicle = await db.vehicle.create({
        data: { name: routeData.vehicleName || 'Auto' },
      })
      vehicleId = vehicle.id
    }

    const route = await db.route.create({
      data: { planningDayId: planningDay.id, vehicleId },
    })

    if (routeData.stops?.length > 0) {
      await db.stop.createMany({
        data: routeData.stops.map((s) => ({
          planningDayId: planningDay.id,
          routeId: route.id,
          type: s.type,
          customerName: s.customerName ?? null,
          address: s.address ?? null,
          rentmagicOrderId: s.rentmagicOrderId ?? null,
          calendarEventId: s.calendarEventId ?? null,
          calendarTitle: s.calendarTitle ?? null,
          calendarStart: s.timeWindowStart ? new Date(s.timeWindowStart) : null,
          calendarEnd: s.timeWindowEnd ? new Date(s.timeWindowEnd) : null,
          sortOrder: s.sortOrder,
        })),
      })
    }
  }

  return NextResponse.json({ ok: true, planningDayId: planningDay.id })
}
