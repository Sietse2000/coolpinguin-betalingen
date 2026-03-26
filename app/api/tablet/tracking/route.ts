import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/tablet/tracking?weekStart=YYYY-MM-DD
// Voor de planningspagina: haalt alle StopTracking rows op voor deze week
export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ tracking: [] })

  try {
    const tracking = await db.stopTracking.findMany({ where: { weekStart } })
    return NextResponse.json({ tracking })
  } catch {
    return NextResponse.json({ tracking: [] })
  }
}

// DELETE /api/tablet/tracking?weekStart=YYYY-MM-DD
// Testmodus: verwijdert alle tracking-records voor de opgegeven week zodat ritten opnieuw beschikbaar zijn
export async function DELETE(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ ok: false, error: 'Missing weekStart' }, { status: 400 })

  try {
    const { count } = await db.stopTracking.deleteMany({ where: { weekStart } })
    return NextResponse.json({ ok: true, deleted: count })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
