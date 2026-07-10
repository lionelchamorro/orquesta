"use client"

import { useEffect, useState } from "react"
import type { SystemStatus } from "@/app/api/system-status/route"

const POLL_MS = 30_000

export type { SystemStatus }

export function useSystemStatus(): { status: SystemStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    async function poll() {
      try {
        const res = await fetch("/api/system-status", { cache: "no-store" })
        if (active && res.ok) setStatus((await res.json()) as SystemStatus)
      } catch {
        // la propia ruta está caída — conservar el último estado conocido
      }
    }
    void poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [tick])

  return { status, refresh: () => setTick((t) => t + 1) }
}
