import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/ritplanning/google-calendar'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/ritplanning?error=google_denied', req.nextUrl.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/ritplanning?error=no_code', req.nextUrl.origin))
  }

  try {
    await exchangeCodeForTokens(code)
    return NextResponse.redirect(new URL('/ritplanning?connected=1', req.nextUrl.origin))
  } catch (err) {
    console.error('[Google Callback] Fout:', err)
    return NextResponse.redirect(new URL('/ritplanning?error=token_exchange', req.nextUrl.origin))
  }
}
