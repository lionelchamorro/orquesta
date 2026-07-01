import { type NextRequest, NextResponse } from "next/server"
import { orquestaApiBaseURL } from "@/lib/orq-lite"

export const dynamic = "force-dynamic"

type Context = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, context: Context) {
  const baseURL = orquestaApiBaseURL()
  if (!baseURL) {
    return NextResponse.json({ detail: "ORQUESTA_API_URL is not configured" }, { status: 503 })
  }

  const { path } = await context.params
  const upstreamURL = new URL(`${baseURL}/${path.join("/")}`)
  upstreamURL.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.delete("connection")

  const upstream = await fetch(upstreamURL, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    cache: "no-store",
  })

  const contentType = upstream.headers.get("content-type") ?? "application/json"
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  })
}

export async function GET(req: NextRequest, context: Context) {
  return proxy(req, context)
}

export async function POST(req: NextRequest, context: Context) {
  return proxy(req, context)
}

export async function PUT(req: NextRequest, context: Context) {
  return proxy(req, context)
}

export async function PATCH(req: NextRequest, context: Context) {
  return proxy(req, context)
}

export async function DELETE(req: NextRequest, context: Context) {
  return proxy(req, context)
}
