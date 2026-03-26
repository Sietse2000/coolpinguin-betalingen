import { NextRequest, NextResponse } from 'next/server'
import { computeTabletSessionToken, TABLET_COOKIE_NAME, TABLET_COOKIE_MAX_AGE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { pin } = await req.json().catch(() => ({ pin: '2340' }))

  const tabletPin = process.env.TABLET_PIN
  if (!tabletPin) {
    return NextResponse.json({ error: 'TABLET_PIN is niet ingesteld op de server' }, { status: 500 })
  }

  // Timing-safe vergelijking
  const a = new TextEncoder().encode(String(pin))
  const b = new TextEncoder().encode(tabletPin)
  let match = a.length === b.length
  if (match) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { match = false }
    }
  }

  if (!match) {
    return NextResponse.json({ error: 'Onjuiste PIN' }, { status: 401 })
  }

  const token = await computeTabletSessionToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(TABLET_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TABLET_COOKIE_MAX_AGE,
    path: '/',
  })
  return res
}
