import { type NextRequest } from "next/server"

// Same-origin bridge so the browser can use the official @opencode-ai/sdk
// against the loopback-only opencode server. The SDK is configured with
// baseUrl "/opencode"; every call lands here and is forwarded verbatim
// (including the SSE /event stream) to OPENCODE_SERVER_URL. Server-side only —
// the opencode URL never reaches the browser.
export const dynamic = "force-dynamic"

const OPENCODE = (process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096").replace(/\/$/, "")

async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const upstream = new URL(`${OPENCODE}/${path.join("/")}`)
  upstream.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.delete("connection")

  const method = req.method
  const res = await fetch(upstream, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await req.text(),
    cache: "no-store",
  })

  // Stream the body through unchanged (handles both JSON and text/event-stream).
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
