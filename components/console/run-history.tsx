"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import { PAGE_SIZE, paginationSlice } from "@/lib/paginate"
import type { AgentRunRecord, OrqRunSummary, RunEvent } from "@/lib/types"

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtDuration(seconds?: number | null): string {
  if (seconds == null) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

function RunDetail({ projectId, run, onBack }: { projectId: string; run: OrqRunSummary; onBack: () => void }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null)
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchJSON<{ events: RunEvent[] }>(
      `/api/control-plane/projects/${projectId}/history/runs/${run.run_id}/events`,
    ).then((page) => {
      if (!cancelled) setEvents(page?.events ?? [])
    })
    fetchJSON<{ agent_runs: AgentRunRecord[] }>(
      `/api/control-plane/projects/${projectId}/history/agent-runs?run_id=${run.run_id}`,
    ).then((page) => {
      if (!cancelled) setAgentRuns(page?.agent_runs ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [projectId, run.run_id])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
          All runs
        </Button>
        <span className="font-mono text-sm font-semibold">{run.run_id}</span>
        <StatusBadge status={run.status} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {fmtDuration(run.duration_s)} · ${run.cost_usd.toFixed(2)} · {fmtTokens(run.input_tokens)} in /{" "}
          {fmtTokens(run.output_tokens)} out
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Agent runs
        </h3>
        {agentRuns === null && <p className="font-mono text-xs text-muted-foreground">Loading…</p>}
        {agentRuns?.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">No agent invocations indexed for this run.</p>
        )}
        {agentRuns && agentRuns.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-4">role</th>
                  <th className="py-1.5 pr-4">agent</th>
                  <th className="py-1.5 pr-4">task</th>
                  <th className="py-1.5 pr-4">c/a</th>
                  <th className="py-1.5 pr-4">duration</th>
                  <th className="py-1.5 pr-4">tokens in/out</th>
                  <th className="py-1.5 pr-4">cost</th>
                  <th className="py-1.5">artifacts</th>
                </tr>
              </thead>
              <tbody>
                {agentRuns.map((record, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1.5 pr-4 text-primary">{record.role}</td>
                    <td className="py-1.5 pr-4">{record.agent}</td>
                    <td className="py-1.5 pr-4">{record.task_id}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">
                      {record.cycle}/{record.attempt}
                    </td>
                    <td className={cn("py-1.5 pr-4", record.timed_out && "text-err")}>
                      {fmtDuration(record.duration_s)}
                      {record.timed_out ? " (timeout)" : ""}
                    </td>
                    <td className="py-1.5 pr-4 text-muted-foreground">
                      {fmtTokens(record.input_tokens)}/{fmtTokens(record.output_tokens)}
                    </td>
                    <td className="py-1.5 pr-4 text-warn">${record.cost_usd.toFixed(3)}</td>
                    <td className="max-w-48 truncate py-1.5 text-muted-foreground" title={record.artifacts_dir}>
                      {record.artifacts_dir}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Event timeline
        </h3>
        {events === null && <p className="font-mono text-xs text-muted-foreground">Loading…</p>}
        {events?.length === 0 && <p className="font-mono text-xs text-muted-foreground">No events indexed.</p>}
        <ul className="max-h-96 space-y-0.5 overflow-y-auto font-mono text-xs">
          {events?.map((event, i) => (
            <li key={i} className="flex items-baseline gap-3 py-1">
              <span className="shrink-0 text-muted-foreground">
                {event.ts.replace(/^.*T/, "").replace(/(\.\d+)?(Z|[+-].*)$/, "")}
              </span>
              <span className="shrink-0 text-primary">{event.event}</span>
              <span className="min-w-0 truncate text-muted-foreground">
                {[event.role, event.agent, event.task_id, event.status].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function RunHistory({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<OrqRunSummary[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [selected, setSelected] = useState<OrqRunSummary | null>(null)
  const [loaded, setLoaded] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    fetchJSON<{ runs: OrqRunSummary[] }>(`/api/control-plane/projects/${projectId}/history/runs`).then(
      (page) => {
        if (cancelled) return
        if (page === null) setUnavailable(true)
        else setRuns(page.runs)
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (unavailable) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-8 text-center">
        <History className="h-5 w-5 text-muted-foreground" />
        <p className="font-mono text-sm text-muted-foreground">Run history is not available.</p>
        <p className="max-w-md font-mono text-xs text-muted-foreground">
          This project&apos;s orq-lite serve predates the query API. Upgrade orq-lite to a version with
          GET /api/runs to see indexed run history, per-agent durations, tokens and cost.
        </p>
      </div>
    )
  }

  if (selected) {
    return <RunDetail projectId={projectId} run={selected} onBack={() => setSelected(null)} />
  }

  const allRuns = runs ?? []
  const { visible: visibleRuns, hasMore } = paginationSlice(allRuns, loaded)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card">
        {runs === null && <p className="p-4 font-mono text-xs text-muted-foreground">Loading run history…</p>}
        {runs?.length === 0 && (
          <p className="p-4 font-mono text-xs text-muted-foreground">No runs indexed yet for this project.</p>
        )}
        <ul className="divide-y divide-border/50">
          {visibleRuns.map((run) => (
            <li key={run.run_id}>
              <button
                onClick={() => setSelected(run)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <StatusBadge status={run.status} />
                <span className="font-mono text-sm">{run.run_id}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {run.command} {run.args.join(" ")}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {run.tasks_done} done{run.tasks_failed > 0 ? ` · ${run.tasks_failed} failed` : ""} ·{" "}
                  {fmtDuration(run.duration_s)} · <span className="text-warn">${run.cost_usd.toFixed(2)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {hasMore && (
        <button
          onClick={() => setLoaded((n) => n + PAGE_SIZE)}
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          Load more ({allRuns.length - loaded} remaining)
        </button>
      )}
    </div>
  )
}
