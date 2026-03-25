import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const drivers = await db.driver.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json({ drivers })
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ ok: false }, { status: 400 })
  try {
    const driver = await db.driver.create({ data: { name: name.trim() } })
    return NextResponse.json({ ok: true, driver })
  } catch {
    return NextResponse.json({ ok: false, error: 'Naam bestaat al' }, { status: 409 })
  }
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ ok: false }, { status: 400 })
  await db.driver.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

// PATCH: schade melden (reset teller) of beloning claimen
// Body: { id, action: 'damage' | 'claim_reward' }
export async function PATCH(req: NextRequest) {
  const { id, action } = await req.json() as { id: string; action: 'damage' | 'claim_reward' }
  if (!id || !action) return NextResponse.json({ ok: false }, { status: 400 })

  const driver = await db.driver.findUnique({ where: { id } })
  if (!driver) return NextResponse.json({ ok: false }, { status: 404 })

  if (action === 'damage') {
    await db.driver.update({ where: { id }, data: { damageFreeKm: 0 } })
  } else if (action === 'claim_reward') {
    // Houd resterende km boven de 4000 over
    const remaining = Math.max(0, driver.damageFreeKm - 4000)
    await db.driver.update({ where: { id }, data: { damageFreeKm: remaining, rewardsEarned: { increment: 1 } } })
  }

  return NextResponse.json({ ok: true })
}
