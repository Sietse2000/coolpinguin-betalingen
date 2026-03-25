import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PATCH /api/tablet/stops/[stopKey]
// Body: { weekStart, vehicleId, status: 'IN_PROGRESS' | 'DONE' | 'SKIPPED', note? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { stopKey: string } }
) {
  const stopKey = decodeURIComponent(params.stopKey)
  const { weekStart, vehicleId, status, note } = await req.json()

  if (!weekStart || !vehicleId || !status) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  const now = new Date()
  const updateData: Record<string, unknown> = { status, driverNote: note ?? null }

  if (status === 'IN_PROGRESS') updateData.startedAt = now
  if (status === 'DONE' || status === 'SKIPPED') updateData.completedAt = now

  try {
    await db.stopTracking.upsert({
      where: { weekStart_vehicleId_stopKey: { weekStart, vehicleId, stopKey } },
      create: { weekStart, vehicleId, stopKey, ...updateData },
      update: updateData,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
