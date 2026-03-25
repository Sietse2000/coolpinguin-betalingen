import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PATCH /api/ritplanning/stops/[id] — wijs stop toe aan route of maak los
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json()
  const { routeId, sortOrder, notes } = body as {
    routeId?: string | null
    sortOrder?: number
    notes?: string
  }

  const stop = await db.stop.update({
    where: { id: params.id },
    data: {
      routeId: routeId !== undefined ? routeId : undefined,
      sortOrder: sortOrder !== undefined ? sortOrder : undefined,
      notes: notes !== undefined ? notes : undefined,
    },
  })

  return NextResponse.json({ stop })
}

// DELETE /api/ritplanning/stops/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await db.stop.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
