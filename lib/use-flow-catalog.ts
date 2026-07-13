"use client"

import { useEffect, useState } from "react"
import { fetchJSON } from "@/lib/fetch-json"
import type { DoctorReport, FlowCatalog, FlowCatalogEntry } from "@/lib/types"

const FALLBACK_FLOWS = ["factory", "factory_fast"] as const

export interface FlowCatalogState {
  flows: FlowCatalogEntry[] | null
  fallbackFlows: readonly string[]
  unavailable: boolean
  doctor: DoctorReport | null
}

export function useFlowCatalog(projectId: string): FlowCatalogState {
  const [flows, setFlows] = useState<FlowCatalogEntry[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchJSON<FlowCatalog>(`/api/control-plane/projects/${projectId}/flow-catalog`).then((data) => {
      if (cancelled) return
      if (data === null || data.flows.length === 0) {
        setUnavailable(true)
        setFlows(null)
      } else {
        setFlows(data.flows)
        setUnavailable(false)
      }
    })
    fetchJSON<DoctorReport>(`/api/control-plane/projects/${projectId}/doctor`).then((data) => {
      if (!cancelled) setDoctor(data)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { flows, fallbackFlows: FALLBACK_FLOWS, unavailable, doctor }
}
