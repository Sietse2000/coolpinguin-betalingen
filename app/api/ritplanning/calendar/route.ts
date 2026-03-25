import { NextRequest, NextResponse } from 'next/server'
import { getCalendarEvents } from '@/lib/ritplanning/google-calendar'

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date')
  const date = dateParam ? new Date(dateParam) : getTomorrow()

  try {
    const events = await getCalendarEvents(date)
    return NextResponse.json({ events })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'GOOGLE_NOT_CONNECTED') {
      return NextResponse.json({ error: 'GOOGLE_NOT_CONNECTED' }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function getTomorrow(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d
}
