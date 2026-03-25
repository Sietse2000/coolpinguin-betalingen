import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/tablet/leaderboard
// Geeft totalen per bezorger over alle sessies
const REWARD_KM = 4000
const REWARD_EUR = 100

export async function GET() {
  try {
    const [sessions, drivers] = await Promise.all([
      db.driverSession.findMany({ orderBy: { date: 'desc' } }),
      db.driver.findMany(),
    ])

    // Aggregeer sessies per bezorger
    const map = new Map<string, { driverName: string; totalKm: number; totalStops: number; days: number; lastDate: string }>()
    for (const s of sessions) {
      const existing = map.get(s.driverName)
      if (existing) {
        existing.totalKm += s.kmDriven ?? 0
        existing.totalStops += s.stopsCompleted
        existing.days += 1
        if (s.date > existing.lastDate) existing.lastDate = s.date
      } else {
        map.set(s.driverName, {
          driverName: s.driverName,
          totalKm: s.kmDriven ?? 0,
          totalStops: s.stopsCompleted,
          days: 1,
          lastDate: s.date,
        })
      }
    }

    // Voeg schadevrije km + beloningsinfo toe vanuit Driver tabel
    const driverByName = new Map(drivers.map((d) => [d.name, d]))
    const leaderboard = Array.from(map.values())
      .map((entry) => {
        const driver = driverByName.get(entry.driverName)
        return {
          ...entry,
          damageFreeKm: driver?.damageFreeKm ?? 0,
          rewardsEarned: driver?.rewardsEarned ?? 0,
          rewardKm: REWARD_KM,
          rewardEur: REWARD_EUR,
          driverId: driver?.id ?? null,
        }
      })
      // Sorteer op schadevrije voortgang (eigen challenge), niet op totaal km
      .sort((a, b) => b.damageFreeKm - a.damageFreeKm)

    return NextResponse.json({ leaderboard })
  } catch (err) {
    return NextResponse.json({ leaderboard: [], error: String(err) })
  }
}
