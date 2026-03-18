import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'ok' })
  } catch (err) {
    return NextResponse.json(
      { status: 'error', db: 'unreachable', error: String(err) },
      { status: 503 }
    )
  }
}
