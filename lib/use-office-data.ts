"use client"

import { useEffect, useRef, useState } from "react"
import type { Project, RunEvent } from "@/lib/types"

export type ConnectionState = "connecting" | "live" | "error"

export interface OfficeData {
  project: Project
  events: RunEvent[]
  connection: ConnectionState
  results: Record<string, unknown>
  diffs: Record<string, string>
  loadResult: (role: string) => Promise<void>
  loadDiff: (taskId: string) => Promise<void>
}

const MAX_EVENTS = 600
const POLL_INTERVAL_MS = 3000

function parseRunEvent(data: string): RunEvent | undefined {
  try {
    return JSON.parse(data) as RunEvent
  } catch {
    return undefined
  }
}

/**
 * Live data for the per-project office view. Snapshot data (tasks/features/
 * cost) comes from the initial server-rendered `project` prop; while a run is
 * active it's refreshed by polling GET /api/control-plane/projects/{id} every
 * 3s (no polling at rest — an idle office costs nothing). Events stream over
 * the per-project SSE endpoint from Task 7/8 with the browser's native
 * EventSource reconnection. Results/diffs are lazy-loaded on demand and
 * cached by role/task id. Everything pauses while the tab is hidden.
 */
export function useOfficeData(initialProject: Project): OfficeData {
  const [project, setProject] = useState(initialProject)
  const [events, setEvents] = useState<RunEvent[]>(initialProject.events ?? [])
  const [connection, setConnection] = useState<ConnectionState>("connecting")
  const [results, setResults] = useState<Record<string, unknown>>({})
  const [diffs, setDiffs] = useState<Record<string, string>>({})
  const visibleRef = useRef(true)

  useEffect(() => {
    function onVisibility() {
      visibleRef.current = document.visibilityState !== "hidden"
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  useEffect(() => {
    setConnection("connecting")
    const es = new EventSource(`/api/control-plane/projects/${project.id}/events`)
    es.onopen = () => setConnection("live")
    es.onmessage = (message) => {
      const event = parseRunEvent(message.data)
      if (!event) return
      setConnection("live")
      setEvents((prev) => [...prev, event].slice(-MAX_EVENTS))
    }
    es.onerror = () => setConnection("error")
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(() => {
    if (project.state !== "running") return
    const interval = setInterval(async () => {
      if (!visibleRef.current) return
      try {
        const res = await fetch(`/api/control-plane/projects/${project.id}`, { cache: "no-store" })
        if (!res.ok) return
        const next: Project = await res.json()
        setProject(next)
      } catch {
        // transient network error; next tick retries
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [project.id, project.state])

  async function loadResult(role: string) {
    if (role in results) return
    try {
      const res = await fetch(`/api/control-plane/projects/${project.id}/result/${role}`, {
        cache: "no-store",
      })
      const data = res.ok ? await res.json() : null
      setResults((prev) => ({ ...prev, [role]: data }))
    } catch {
      setResults((prev) => ({ ...prev, [role]: null }))
    }
  }

  async function loadDiff(taskId: string) {
    if (taskId in diffs) return
    try {
      const res = await fetch(`/api/control-plane/projects/${project.id}/diff/${taskId}`, {
        cache: "no-store",
      })
      const text = res.ok ? await res.text() : ""
      setDiffs((prev) => ({ ...prev, [taskId]: text }))
    } catch {
      setDiffs((prev) => ({ ...prev, [taskId]: "" }))
    }
  }

  return { project, events, connection, results, diffs, loadResult, loadDiff }
}
