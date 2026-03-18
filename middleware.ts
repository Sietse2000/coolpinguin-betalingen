import { NextRequest, NextResponse } from 'next/server'
import { computeSessionToken, COOKIE_NAME } from '@/lib/auth'

const PUBLIC = ['/login', '/api/health', '/api/auth']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value
  const expected = await computeSessionToken()

  if (!cookie || cookie !== expected) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
