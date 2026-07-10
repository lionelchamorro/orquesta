"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GitBranch, Folder, GitPullRequest, CircleDot, Gamepad2, Radar, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { FactoryQueue } from "@/components/console/factory-queue"
import { TasksTable } from "@/components/console/tasks-table"
import { LiveEvents } from "@/components/console/live-events"
import { GlobalChat } from "@/components/console/global-chat"
import { FlowLauncher } from "@/components/console/flow-launcher"
import { RunHistory } from "@/components/console/run-history"
import type { Project, Run } from "@/lib/types"

const tabs = ["Factory", "Tasks", "Runs", "Chat"] as const
type Tab = (typeof tabs)[number]

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

function QueuedRuns({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchJSON<Run[]>(`/api/control-plane/runs?project=${projectId}&state=queued`).then((data) => {
      if (!cancelled) setRuns(data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function refresh() {
    const data = await fetchJSON<Run[]>(
      `/api/control-plane/runs?project=${projectId}&state=queued`,
    )
    setRuns(data ?? [])
  }

  async function cancelRun(runId: string) {
    setCancelling(runId)
    try {
      await fetch(`/api/control-plane/runs/${runId}/stop`, { method: "POST" })
      await refresh()
    } finally {
      setCancelling(null)
    }
  }

  if (runs === null || runs.length === 0) return null

  return (
    <div className="mt-4 rounded-xl border border-border bg-card">
      <div className="border-b border-border/50 px-4 py-2 font-mono text-xs text-muted-foreground">
        Queued runs
      </div>
      <ul className="divide-y divide-border/50">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <StatusBadge status={run.state} />
            <span className="font-mono text-sm">{run.flow ?? run.kind}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {Object.entries(run.inputs ?? {})
                .map(([key, value]) => `${key}=${value}`)
                .join(" ")}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-xs"
              disabled={cancelling === run.id}
              onClick={() => cancelRun(run.id)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProjectView({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>("Factory")

  return (
    <div className="grid flex-1 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 p-5 md:p-7">
        {/* meta strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card p-4 font-mono text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Folder className="h-3.5 w-3.5" />
            {project.workspace_path}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            {project.base_branch}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              project.watch.prs ? "text-foreground" : "opacity-40",
            )}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            PR watcher {project.watch.prs ? "on" : "off"}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              project.watch.issues ? "text-foreground" : "opacity-40",
            )}
          >
            <CircleDot className="h-3.5 w-3.5" />
            Issue watcher {project.watch.issues ? "on" : "off"}
          </span>
          <span className="ml-auto text-warn">${project.cost_usd.toFixed(2)} spend</span>
        </div>
        <QueuedRuns projectId={project.id} />

        {/* tabs */}
        <div className="mt-6 flex items-center gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 font-mono text-sm transition-colors",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === "Factory" && <FactoryQueue features={project.features} />}
          {tab === "Tasks" && <TasksTable tasks={project.tasks} />}
          {tab === "Runs" && <RunHistory projectId={project.id} />}
          {tab === "Chat" && (
            <div className="h-[60vh] overflow-hidden rounded-xl border border-border bg-card">
              <GlobalChat compact />
            </div>
          )}
        </div>
      </div>

      {/* right rail: live events */}
      <div className="hidden border-l border-border xl:block">
        <div className="sticky top-16 h-[calc(100dvh-4rem)]">
          <LiveEvents projectId={project.id} initial={project.events} />
        </div>
      </div>
    </div>
  )
}

export function ProjectActions({ project }: { project: Project }) {
  const [launchingWatch, setLaunchingWatch] = useState(false)
  const [watchMessage, setWatchMessage] = useState("")

  const isRunning = project.state === "running"
  const watchEnabled = project.watch.prs || project.watch.issues

  async function launchWatchDaemon() {
    setLaunchingWatch(true)
    setWatchMessage("")
    try {
      const res = await fetch(`/api/control-plane/projects/${project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "watch" }),
      })
      if (res.status === 409) {
        setWatchMessage("run already active")
        return
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        setWatchMessage(`launch failed: ${detail?.detail ?? `HTTP ${res.status}`}`)
        return
      }
      setWatchMessage("watch daemon started")
    } catch (err) {
      setWatchMessage(`launch failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLaunchingWatch(false)
    }
  }

  return (
    <>
      <StatusBadge status={project.state} />
      <Button asChild size="sm" variant="outline" className="font-mono text-xs">
        <Link href={`/projects/${project.id}/office`}>
          <Gamepad2 className="h-3.5 w-3.5" />
          Office
        </Link>
      </Button>
      <FlowLauncher projectId={project.id} disabled={false} />
      {watchEnabled && (
        <Button
          size="sm"
          variant="outline"
          className="font-mono text-xs"
          disabled={isRunning || launchingWatch}
          onClick={launchWatchDaemon}
          title="Fallback for projects without a GitHub webhook configured: supervises `orq-lite watch --prs --issues` as a long-lived run"
        >
          <Radar className="h-3.5 w-3.5" />
          Start watch daemon
        </Button>
      )}
      {watchMessage && (
        <span
          className={cn(
            "font-mono text-[11px]",
            watchMessage.startsWith("launch failed") ? "text-err" : "text-muted-foreground",
          )}
        >
          {watchMessage}
        </span>
      )}
    </>
  )
}
