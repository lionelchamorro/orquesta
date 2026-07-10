import { NextResponse } from "next/server"
import { orquestaApiBaseURL } from "@/lib/orq-lite"

export const dynamic = "force-dynamic"

export interface SystemStatus {
  api: "up" | "down"
  opencode: "up" | "down"
  mcp: "up" | "down"
  activeRuns: number | null
}

// "up" exige respuesta HTTP 2xx.
async function probeOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

// El MCP es JSON-RPC sobre POST: un GET devuelve 4xx, pero cualquier respuesta
// HTTP prueba que el proceso está vivo — solo el error de red cuenta como caído.
async function probeAlive(url: string): Promise<boolean> {
  try {
    await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

async function countActiveRuns(baseURL: string): Promise<number | null> {
  try {
    const token = process.env.ORQUESTA_API_TOKEN
    const res = await fetch(`${baseURL}/runs`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) return null
    const runs = (await res.json()) as Array<{ state?: string }>
    return runs.filter((r) => r.state === "running").length
  } catch {
    return null
  }
}

export async function GET() {
  const apiBase = orquestaApiBaseURL()
  const opencodeBase = (process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096").replace(/\/$/, "")
  const mcpBase = (process.env.ORQUESTA_MCP_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "")

  const [api, opencode, mcp, activeRuns] = await Promise.all([
    apiBase ? probeOk(`${apiBase}/health`) : Promise.resolve(false),
    probeOk(`${opencodeBase}/config`),
    probeAlive(`${mcpBase}/mcp`),
    apiBase ? countActiveRuns(apiBase) : Promise.resolve(null),
  ])

  const status: SystemStatus = {
    api: api ? "up" : "down",
    opencode: opencode ? "up" : "down",
    mcp: mcp ? "up" : "down",
    activeRuns,
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } })
}
