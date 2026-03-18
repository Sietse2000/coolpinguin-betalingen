import { NextResponse } from 'next/server'
import { cleanupExpired } from '@/lib/cleanup/cleanup'

/**
 * POST /api/cleanup
 * Handmatige trigger voor cleanup van verlopen importdata.
 * Kan ook aangeroepen worden via een externe cron (bijv. Vercel Cron, GitHub Actions)
 * als je dat later wil toevoegen.
 */
export async function POST() {
  try {
    const result = await cleanupExpired()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Gebruik POST om cleanup te starten' }, { status: 405 })
}
