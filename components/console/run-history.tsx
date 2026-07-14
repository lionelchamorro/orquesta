"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, Copy, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { ArtifactsPane } from "@/components/console/artifacts-pane"
import { fetchJSON } from "@/lib/fetch-json"
import { fmtDuration, fmtRelative, fmtRunLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PAGE_SIZE, paginationSlice } from "@/lib/paginate"
import type { AgentRunRecord, OrqRunSummary, RunEvent } from "@/lib/types"

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Determine whether a run status represents a failure. */
function isFailedStatus(status: string): boolean {
  return status === "error" || status === "interrupted"
}

// ---------------------------------------------------------------------------
// RunDetail
// ---------------------------------------------------------------------------

function RunDetail({
  projectId,
  run,
  onBack,
}: {
  projectId: string
  run: OrqRunSummary
  onBack: () => void
}) {
  const [events, setEvents] = useState<RunEvent[] | null>(null)
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[] | null>(null)
  const [artifactsOpen, setArtifactsOpen] = useState(false)

  const isErrored = isFailedStatus(run.status)
  const flowName = fmtRunLabel(run.command)

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

  const failedAgents = agentRuns?.filter((r) => r.exit_code !== 0 || r.timed_out) ?? []

  // Gather agent artifact dirs for the artifacts pane — only unique dirs.
  const artifactDirs = agentRuns
    ? [...new Set(agentRuns.map((r) => r.artifacts_dir).filter(Boolean))]
    : []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
          All runs
        </Button>
        <span className="font-mono text-sm font-semibold">{flowName}</span>
        <StatusBadge status={run.status} />
        <CopyableId id={run.run_id} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {fmtDuration(run.duration_s)} · ${run.cost_usd.toFixed(2)} · {fmtTokens(run.input_tokens)}{" "}
          in / {fmtTokens(run.output_tokens)} out
        </span>
      </div>

      {/* Error banner — shown prominently for failed runs */}
      {isErrored && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="mb-1 font-mono text-xs font-semibold uppercase tracking-wide text-red-500">
            Run failed · status: {run.status}
          </p>
          {failedAgents.length > 0 ? (
            <ul className="space-y-0.5 font-mono text-xs text-foreground">
              {failedAgents.map((a, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{a.role}</span>
                  {a.agent && <span className="text-muted-foreground"> ({a.agent})</span>}
                  {a.task_id && (
                    <span className="text-muted-foreground"> task {a.task_id}</span>
                  )}
                  {" — "}
                  {a.timed_out ? (
                    <span className="text-err">timed out</span>
                  ) : (
                    <span className="text-err">exit code {a.exit_code}</span>
                  )}
                  {a.artifacts_dir && (
                    <span className="ml-2 text-muted-foreground">
                      → see stderr.log in artifacts
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : agentRuns === null ? (
            <p className="font-mono text-xs text-muted-foreground">Loading failure details…</p>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              No agent-level exit codes recorded. Check run artifacts for details.
            </p>
          )}
        </div>
      )}

      {/* Agent runs table */}
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
                  <th className="py-1.5">exit</th>
                </tr>
              </thead>
              <tbody>
                {agentRuns.map((record, i) => {
                  const failed = record.exit_code !== 0 || record.timed_out
                  return (
                    <tr key={i} className={cn("border-t border-border/50", failed && "bg-red-500/5")}>
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
                      <td className={cn("py-1.5", failed ? "text-err" : "text-muted-foreground")}>
                        {record.timed_out ? "timeout" : record.exit_code}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event timeline */}
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
              <span className={cn("shrink-0", event.status === "error" ? "text-err" : "text-primary")}>
                {event.event}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                {[event.role, event.agent, event.task_id, event.status, event.reason]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Artifacts browser */}
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          className="mb-2 flex w-full items-center justify-between font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          onClick={() => setArtifactsOpen((o) => !o)}
        >
          <span>Artifacts</span>
          <span className="text-xs normal-case">
            {artifactsOpen ? "collapse" : "browse files"}
          </span>
        </button>
        {artifactsOpen && (
          <ArtifactsPane projectId={projectId} runId={run.run_id} />
        )}
        {!artifactsOpen && (
          <p className="font-mono text-xs text-muted-foreground">
            {artifactDirs.length > 0
              ? `${artifactDirs.length} agent artifact director${artifactDirs.length === 1 ? "y" : "ies"} — click "browse files" to explore`
              : "Artifact dirs will appear here once agent runs are indexed."}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CopyableId — small inline monospace ID with a click-to-copy button
// ---------------------------------------------------------------------------

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy run ID"
      className="flex items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      {id}
      <Copy className={cn("h-3 w-3 shrink-0", copied && "text-primary")} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// RunHistory — the list view
// ---------------------------------------------------------------------------

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
          {visibleRuns.map((run) => {
            const isErrored = isFailedStatus(run.status)
            const flowName = fmtRunLabel(run.command)
            return (
              <li key={run.run_id}>
                <button
                  onClick={() => setSelected(run)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <StatusBadge status={run.status} />
                  {/* Primary: flow name · relative time */}
                  <span className="font-mono text-sm font-medium">
                    {flowName} · {fmtRelative(run.started_at)}
                  </span>
                  {/* Secondary: run ID (dimmer, smaller) */}
                  <span className="font-mono text-xs text-muted-foreground/60">
                    {run.run_id}
                  </span>
                  {/* Error summary for failed runs */}
                  {isErrored && (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-xs text-red-500">
                      failed
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {run.tasks_done > 0 || run.tasks_failed > 0 ? (
                      <>
                        {run.tasks_done} done
                        {run.tasks_failed > 0 && (
                          <span className="text-err"> · {run.tasks_failed} failed</span>
                        )}{" "}
                        ·{" "}
                      </>
                    ) : null}
                    {fmtDuration(run.duration_s)} · <span className="text-warn">${run.cost_usd.toFixed(2)}</span>
                  </span>
                </button>
              </li>
            )
          })}
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
