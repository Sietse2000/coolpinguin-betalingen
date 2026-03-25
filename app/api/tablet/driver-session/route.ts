import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/tablet/driver-session?date=YYYY-MM-DD
// Geeft alle sessies voor een dag + lijst van bekende namen (voor autocomplete)
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  try {
    const [sessions, recentNames] = await Promise.all([
      date ? db.driverSession.findMany({ where: { date } }) : [],
      db.driverSession.findMany({
        select: { driverName: true },
        distinct: ['driverName'],
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ])
    return NextResponse.json({ sessions, recentNames: recentNames.map((r) => r.driverName) })
  } catch (err) {
    return NextResponse.json({ sessions: [], recentNames: [], error: String(err) })
  }
}

// POST /api/tablet/driver-session
// Body: { date, driverName, vehicleName?, vehicleId?, kmDriven?, stopsCompleted? }
export async function POST(req: NextRequest) {
  const { date, driverName, vehicleName, vehicleId, kmDriven, stopsCompleted } = await req.json()
  if (!date || !driverName) return NextResponse.json({ ok: false }, { status: 400 })

  try {
    const updateData: Record<string, unknown> = {}
    if (vehicleName !== undefined) updateData.vehicleName = vehicleName
    if (vehicleId !== undefined) updateData.vehicleId = vehicleId
    if (kmDriven !== undefined) updateData.kmDriven = kmDriven
    if (stopsCompleted !== undefined) updateData.stopsCompleted = stopsCompleted

    // Haal bestaande sessie op om km-verschil te berekenen
    const existing = await db.driverSession.findUnique({ where: { date_driverName: { date, driverName } } })
    const prevKm = existing?.kmDriven ?? 0
    const newKm: number | undefined = kmDriven

    await db.driverSession.upsert({
      where: { date_driverName: { date, driverName } },
      create: { date, driverName, vehicleName, vehicleId, kmDriven, stopsCompleted: stopsCompleted ?? 0 },
      update: updateData,
    })

    // Voeg de extra km toe aan de schadevrije teller van de bezorger
    if (newKm !== undefined && newKm > prevKm) {
      const extraKm = newKm - prevKm
      await db.driver.updateMany({
        where: { name: driverName },
        data: { damageFreeKm: { increment: extraKm } },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
