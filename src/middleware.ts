import { NextRequest, NextResponse } from 'next/server'

// Basic-auth gate. Only enforced when MC_PASSWORD is set, so local
// `npm run dev` on this machine stays open and the tunnel is protected.
const USER = process.env.MC_USER || 'shib'
const PASSWORD = process.env.MC_PASSWORD

export function middleware(req: NextRequest) {
  if (!PASSWORD) return NextResponse.next()

  const header = req.headers.get('authorization')
  if (header?.startsWith('Basic ')) {
    const [user, pass] = atob(header.slice(6)).split(':')
    if (user === USER && pass === PASSWORD) return NextResponse.next()
  }

  return new NextResponse('Auth required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mission Control"' },
  })
}

export const config = {
  // /api/ingest is excluded because the pusher authenticates with a bearer
  // token instead (see that route) — it must never need Shib's password.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/ingest).*)'],
}
