import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const raw = req.cookies.get('session')?.value
    if (!raw) {
      return NextResponse.redirect(new URL('/', req.url))
    }
    try {
      const session = JSON.parse(raw)
      if (!session?.isAdmin) {
        return NextResponse.redirect(new URL('/', req.url))
      }
    } catch {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }
  return NextResponse.next()
}

export const config = { matcher: ['/admin/:path*'] }


