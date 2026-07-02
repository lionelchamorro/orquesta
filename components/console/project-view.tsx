"use client"

import { useState } from "react"
import { Play, GitBranch, Folder, GitPullRequest, CircleDot } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { FactoryQueue } from "@/components/console/factory-queue"
import { TasksTable } from "@/components/console/tasks-table"
import { LiveEvents } from "@/components/console/live-events"
import { GlobalChat } from "@/components/console/global-chat"
import type { Project } from "@/lib/types"

const tabs = ["Factory", "Tasks", "Chat"] as const
type Tab = (typeof tabs)[number]

export function ProjectView({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>("Factory")
  const live = project.state === "running"

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
          {tab === "Chat" && (
            <div className="h-[60vh] overflow-hidden rounded-xl border border-border bg-card">
              <GlobalChat compact projects={[project]} />
            </div>
          )}
        </div>
      </div>

      {/* right rail: live events */}
      <div className="hidden border-l border-border xl:block">
        <div className="sticky top-16 h-[calc(100dvh-4rem)]">
          <LiveEvents projectId={project.id} initial={project.events} live={live} />
        </div>
      </div>
    </div>
  )
}

const RUN_OPTIONS = [
  { value: "factory", label: "factory" },
  { value: "factory_fast_governed", label: "factory_fast_governed" },
  { value: "pr_review", label: "pr_review" },
  { value: "issue_fix", label: "issue_fix" },
] as const

type RunOption = (typeof RUN_OPTIONS)[number]["value"]

export function ProjectActions({ project }: { project: Project }) {
  const [kind, setKind] = useState<RunOption>("factory")
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState("")

  const isRunning = project.state === "running"
  const disabled = isRunning || launching

  async function launchRun() {
    setLaunching(true)
    setMessage("")
    try {
      const body =
        kind === "factory"
          ? { kind: "factory" }
          : { kind: "flow", flow: kind, inputs: {} }

      const res = await fetch(`/api/control-plane/projects/${project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (res.status === 409) {
        setMessage("run already active")
        return
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        setMessage(`launch failed: ${detail?.detail ?? `HTTP ${res.status}`}`)
        return
      }
      setMessage("launched")
    } catch (err) {
      setMessage(`launch failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLaunching(false)
    }
  }

  return (
    <>
      <StatusBadge status={project.state} />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as RunOption)}
        disabled={disabled}
        className="rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50 disabled:opacity-50"
      >
        {RUN_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Button size="sm" className="font-mono text-xs" disabled={disabled} onClick={launchRun}>
        <Play className="h-3.5 w-3.5" />
        {launching ? "launching…" : "Run"}
      </Button>
      {message && (
        <span
          className={cn(
            "font-mono text-[11px]",
            message.startsWith("launch failed") ? "text-err" : "text-muted-foreground",
          )}
        >
          {message}
        </span>
      )}
    </>
  )
}
