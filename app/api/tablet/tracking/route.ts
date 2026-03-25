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
