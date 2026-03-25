import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const vehicles = await db.vehicle.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ vehicles })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, licensePlate, hasTrailer } = body

  if (!name) {
    return NextResponse.json({ error: 'Naam is verplicht' }, { status: 400 })
  }

  const vehicle = await db.vehicle.create({
    data: { name, licensePlate: licensePlate || null, hasTrailer: hasTrailer ?? false },
  })
  return NextResponse.json({ vehicle }, { status: 201 })
}
