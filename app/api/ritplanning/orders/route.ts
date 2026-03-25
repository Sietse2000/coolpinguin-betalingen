import { NextRequest, NextResponse } from 'next/server'
import { fetchOrdersForDate } from '@/lib/ritplanning/rentmagic-orders'

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date')
  const date = dateParam ? new Date(dateParam) : getTomorrow()

  try {
    const orders = await fetchOrdersForDate(date)
    return NextResponse.json({ orders })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function getTomorrow(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d
}
