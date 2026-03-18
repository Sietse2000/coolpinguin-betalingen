import { NextRequest, NextResponse } from 'next/server'
import { computeSessionToken, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }))

  const appPassword = process.env.APP_PASSWORD
  if (!appPassword) {
    return NextResponse.json({ error: 'APP_PASSWORD is niet ingesteld op de server' }, { status: 500 })
  }

  // Timing-safe vergelijking om brute-force timing attacks te voorkomen
  const a = new TextEncoder().encode(String(password))
  const b = new TextEncoder().encode(appPassword)
  let match = a.length === b.length
  if (match) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { match = false }
    }
  }

  if (!match) {
    return NextResponse.json({ error: 'Ongeldig wachtwoord' }, { status: 401 })
  }

  const token = await computeSessionToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return res
}
