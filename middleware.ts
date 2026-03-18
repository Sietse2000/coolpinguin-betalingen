import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'session'

const PUBLIC_PREFIXES = [
  '/login',
  '/api/health',
  '/api/auth',
  '/_next',
  '/favicon.ico',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const session = req.cookies.get(COOKIE_NAME)?.value
  if (!session) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
