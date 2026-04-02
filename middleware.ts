import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'session'
const TABLET_COOKIE_NAME = 'tablet_session'

// Volledig open — geen auth
const PUBLIC_PREFIXES = [
  '/login',
  '/api/health',
  '/api/auth',
  '/api/tablet',   // tablet API altijd open (cookie-check zit op de pagina zelf)
  '/api/drivers',
  '/tablet/login', // tablet login pagina
  '/_next',
  '/favicon.ico',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  // ── Tablet pagina's: apart cookie ──────────────────────────────────────────
  if (pathname === '/tablet' || pathname.startsWith('/tablet/')) {
    const tabletSession = req.cookies.get(TABLET_COOKIE_NAME)?.value
    if (!tabletSession) {
      const url = req.nextUrl.clone()
      url.pathname = '/tablet/login'
      return NextResponse.redirect(url)
    }
    const { computeTabletSessionToken } = await import('@/lib/auth')
    const expected = await computeTabletSessionToken()
    if (tabletSession !== expected) {
      const url = req.nextUrl.clone()
      url.pathname = '/tablet/login'
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // ── Planner pagina's: standaard sessie-cookie ───────────────────────────
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
