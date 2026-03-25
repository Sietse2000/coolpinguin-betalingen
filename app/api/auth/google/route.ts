import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/ritplanning/google-calendar'

export async function GET() {
  try {
    const url = getAuthUrl()
    return NextResponse.redirect(url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
