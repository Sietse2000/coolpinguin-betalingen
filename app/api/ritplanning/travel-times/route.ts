import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'

/**
 * POST /api/ritplanning/travel-times
 *
 * Vraagt rijtijden op via Google Maps Distance Matrix API voor alle combinaties
 * van de meegegeven adressen (inclusief het depotadres).
 *
 * Body: { addresses: string[] }   — stop-adressen (depot wordt automatisch toegevoegd)
 * Response: { depot: string; pairs: Record<string, number> }
 *   pairs is een map van "van|naar" → minuten
 */
export async function POST(req: NextRequest) {
  const { addresses } = (await req.json()) as { addresses: string[] }

  if (!addresses || addresses.length === 0) {
    return NextResponse.json({ depot: env.DEPOT_ADDRESS, pairs: {} })
  }

  const apiKey = env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    // Geen API-key geconfigureerd — stuur lege pairs terug (valt terug op vaste reistijd)
    return NextResponse.json({ depot: env.DEPOT_ADDRESS, pairs: {} })
  }

  const depot = env.DEPOT_ADDRESS
  const allAddresses = [depot, ...addresses]
  const seen = new Set<string>()
  const unique = allAddresses.filter((a) => { if (!a || seen.has(a)) return false; seen.add(a); return true })

  if (unique.length < 2) {
    return NextResponse.json({ depot, pairs: {} })
  }

  const encoded = unique.map(encodeURIComponent).join('|')
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${encoded}` +
    `&destinations=${encoded}` +
    `&mode=driving` +
    `&language=nl` +
    `&key=${apiKey}`

  const res = await fetch(url)
  const data = await res.json() as {
    status: string
    rows: Array<{ elements: Array<{ status: string; duration: { value: number } }> }>
  }

  if (data.status !== 'OK') {
    console.error('[travel-times] Distance Matrix fout:', data.status)
    return NextResponse.json({ depot, pairs: {} })
  }

  const pairs: Record<string, number> = {}
  for (let i = 0; i < unique.length; i++) {
    const row = data.rows[i]
    for (let j = 0; j < unique.length; j++) {
      if (i === j) continue
      const el = row?.elements[j]
      if (el?.status === 'OK') {
        const minutes = Math.ceil(el.duration.value / 60)
        pairs[`${unique[i]}|${unique[j]}`] = minutes
      }
    }
  }

  return NextResponse.json({ depot, pairs })
}
