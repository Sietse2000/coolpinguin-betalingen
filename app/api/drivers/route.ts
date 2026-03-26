import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const WELCOME_BONUS_KM = 100

export async function GET() {
  const drivers = await db.driver.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json({ drivers })
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ ok: false }, { status: 400 })
  try {
    const driver = await db.driver.create({
      data: { name: name.trim(), damageFreeKm: WELCOME_BONUS_KM, welcomeBonusGiven: true },
    })
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

// PATCH: schade melden of beloning claimen
// Body: { id, action: 'damage_reported' | 'damage_unreported' | 'claim_reward', reportedBy?, note? }
export async function PATCH(req: NextRequest) {
  const { id, action, reportedBy, note } = await req.json() as {
    id: string
    action: 'damage_reported' | 'damage_unreported' | 'damage' | 'claim_reward'
    reportedBy?: string
    note?: string
  }
  if (!id || !action) return NextResponse.json({ ok: false }, { status: 400 })

  const driver = await db.driver.findUnique({ where: { id } })
  if (!driver) return NextResponse.json({ ok: false }, { status: 404 })

  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  if (action === 'damage_reported') {
    // Gemelde schade: behoud max 500 km (maar nooit meer dan wat gereden is)
    const kmToKeep = Math.min(driver.damageFreeKm, 500)
    await db.driver.update({ where: { id }, data: { damageFreeKm: kmToKeep } })
    await db.damageReport.create({
      data: { driverName: driver.name, driverId: id, isReported: true, kmAtTime: driver.damageFreeKm, reportedBy: reportedBy ?? null, note: note ?? null, date: dateStr },
    })
  } else if (action === 'damage_unreported' || action === 'damage') {
    // Niet-gemelde schade (of legacy 'damage'): reset naar 0
    await db.driver.update({ where: { id }, data: { damageFreeKm: 0 } })
    await db.damageReport.create({
      data: { driverName: driver.name, driverId: id, isReported: false, kmAtTime: driver.damageFreeKm, reportedBy: reportedBy ?? null, note: note ?? null, date: dateStr },
    })
  } else if (action === 'claim_reward') {
    const remaining = Math.max(0, driver.damageFreeKm - 4000)
    await db.driver.update({ where: { id }, data: { damageFreeKm: remaining, rewardsEarned: { increment: 1 } } })
  }

  return NextResponse.json({ ok: true })
}
