import { NextResponse, type NextRequest } from "next/server"

const SESSION_COOKIE = "orquesta_session"

// Single-user v1 (D-decision, Task 12): the dashboard is gated behind one
// shared password stored server-side as ORQUESTA_UI_PASSWORD. When that var
// is unset the gate is a no-op (matches the backend's own auth_token-empty =
// disabled default for local dev).
export function middleware(request: NextRequest) {
  const password = process.env.ORQUESTA_UI_PASSWORD
  if (!password) return NextResponse.next()

  const session = request.cookies.get(SESSION_COOKIE)?.value
  if (session === password) return NextResponse.next()

  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("next", request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*"],
}
