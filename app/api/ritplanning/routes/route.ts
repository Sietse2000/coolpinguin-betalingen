import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST — maak een nieuwe rit aan voor een planningsdag + voertuig
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { planningDayId, vehicleId, driverName } = body as {
    planningDayId: string
    vehicleId: string
    driverName?: string
  }

  if (!planningDayId || !vehicleId) {
    return NextResponse.json({ error: 'planningDayId en vehicleId zijn verplicht' }, { status: 400 })
  }

  const route = await db.route.create({
    data: { planningDayId, vehicleId, driverName: driverName ?? null },
    include: { vehicle: true, stops: true },
  })

  return NextResponse.json({ route }, { status: 201 })
}

// DELETE /api/ritplanning/routes?id=xxx
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id verplicht' }, { status: 400 })

  // Maak stops los van route voordat we verwijderen
  await db.stop.updateMany({ where: { routeId: id }, data: { routeId: null } })
  await db.route.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
