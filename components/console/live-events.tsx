"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import type { RunEvent } from "@/lib/types"

// If we haven't heard from the EventSource (no onopen / onmessage) within this
// many milliseconds, transition to "disconnected" so the UI shows a retry button
// rather than a perpetual spinner.
const CONNECT_TIMEOUT_MS = 10_000

function parseRunEvent(data: string): RunEvent | undefined {
  try {
    return JSON.parse(data) as RunEvent
  } catch {
    return undefined
  }
}

function fmtTime(iso: string) {
  return iso.replace(/^.*T/, "").replace(/(\.\d+)?(Z|[+-].*)$/, "")
}

function describe(e: RunEvent) {
  switch (e.event) {
    case "agent_run":
      return (
        <span>
          <span className="text-primary">{e.role}</span> {e.agent}{" "}
          <StatusBadge status={e.status} />{" "}
          <span className="text-muted-foreground">
            {e.task_id} {e.duration_s ? `${e.duration_s}s` : ""}
          </span>
        </span>
      )
    case "task_start":
      return (
        <span>
          task <b>{e.task_id}</b> started
        </span>
      )
    case "task_done":
      return (
        <span>
          task <b>{e.task_id}</b> <StatusBadge status="done" />{" "}
          <span className="text-muted-foreground">{e.commit_sha?.slice(0, 8)}</span>
        </span>
      )
    case "task_failed":
      return (
        <span>
          task <b>{e.task_id}</b> <StatusBadge status="failed" />{" "}
          <span className="text-muted-foreground">{e.reason}</span>
        </span>
      )
    case "cycle_start":
      return <span className="text-run">— review cycle {e.cycle} —</span>
    case "cycle_end":
      return (
        <span>
          cycle {e.cycle} ended{" "}
          <span className="text-muted-foreground">new tasks: {e.new_tasks_proposed ?? 0}</span>
        </span>
      )
    case "tester_verification_failed":
      return (
        <span>
          tester claimed pass but <code className="text-err">{e.command}</code> failed
        </span>
      )
    default:
      return <span>{e.event}</span>
  }
}

const borderColor: Record<string, string> = {
  agent_run: "border-l-primary",
  task_done: "border-l-ok",
  task_failed: "border-l-err",
  tester_verification_failed: "border-l-err",
  full_suite_failed: "border-l-err",
  cycle_start: "border-l-run",
  cycle_end: "border-l-run",
}

export type ConnectionState = "idle" | "connecting" | "streaming" | "error" | "disconnected"

export const connectionLabel: Record<ConnectionState, string> = {
  idle: "idle",
  connecting: "connecting…",
  streaming: "streaming · live",
  error: "connection error · retrying",
  disconnected: "disconnected",
}

export const connectionDot: Record<ConnectionState, string> = {
  idle: "bg-muted-foreground",
  connecting: "animate-pulse bg-run",
  streaming: "animate-pulse bg-ok",
  error: "bg-err",
  disconnected: "bg-err",
}

/** Returns true when the connection state should surface a manual retry button. */
export function connectionShowsRetry(state: ConnectionState): boolean {
  return state === "disconnected" || state === "error"
}

export function LiveEvents({
  projectId,
  initial,
}: {
  projectId: string
  initial: RunEvent[]
}) {
  const [events, setEvents] = useState<RunEvent[]>(initial)
  // Only EventSource callbacks (async) write this (react-hooks set-state-in-effect).
  // The SSE stays open regardless of project.state — events flow whenever a run
  // (factory OR the background watch daemon) is active, so the panel must not be
  // gated on the project being "running".
  const [esState, setEsState] = useState<Exclude<ConnectionState, "idle">>("connecting")
  // Incrementing retryKey tears down the old EventSource and creates a fresh one.
  const [retryKey, setRetryKey] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const retry = useCallback(() => {
    setEsState("connecting")
    setRetryKey((k) => k + 1)
  }, [])

  useEffect(() => {
    const es = new EventSource(`/api/control-plane/projects/${projectId}/events`)

    // If neither onopen nor onmessage fires within CONNECT_TIMEOUT_MS, the
    // proxy/backend is not reachable — surface a disconnected state with a
    // retry button instead of showing "connecting…" forever.
    const connectTimer = setTimeout(() => {
      setEsState((prev) => (prev === "connecting" ? "disconnected" : prev))
    }, CONNECT_TIMEOUT_MS)

    es.onopen = () => {
      clearTimeout(connectTimer)
      setEsState("streaming")
    }
    es.onmessage = (message) => {
      clearTimeout(connectTimer)
      const event = parseRunEvent(message.data)
      if (!event) return
      setEsState("streaming")
      setEvents((prev) => [...prev, event].slice(-200))
    }
    es.onerror = () => {
      clearTimeout(connectTimer)
      setEsState("error")
    }
    return () => {
      clearTimeout(connectTimer)
      es.close()
    }
  }, [projectId, retryKey])

  const connection: ConnectionState = esState

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className={cn("h-2 w-2 rounded-full", connectionDot[connection])} />
        <span className="font-mono text-sm font-semibold">Live events</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {connectionLabel[connection]}
        </span>
        {(connection === "disconnected" || connection === "error") && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 font-mono text-[11px]"
            onClick={retry}
            aria-label="Retry SSE connection"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
      <ul ref={listRef} className="flex-1 space-y-0.5 overflow-y-auto py-2 font-mono text-xs">
        {events.length === 0 && (
          <li className="px-4 py-6 text-center text-muted-foreground">No events yet.</li>
        )}
        {[...events].reverse().map((e, i) => (
          <li
            key={`${e.ts}-${i}`}
            className={cn(
              "flex items-baseline gap-3 border-l-2 border-l-transparent px-4 py-1.5",
              borderColor[e.event],
            )}
          >
            <span className="shrink-0 text-muted-foreground">{fmtTime(e.ts)}</span>
            <span className="min-w-0 break-words">{describe(e)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
