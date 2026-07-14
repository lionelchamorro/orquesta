"use client"

import { useEffect, useState } from "react"
import { Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFlowCatalog } from "@/lib/use-flow-catalog"
import type { ConnectionState } from "@/lib/use-office-data"
import type { Project } from "@/lib/types"
import { roleIdentity } from "./sprites"

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "connecting…",
  live: "live",
  error: "reconnecting…",
}

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: "motion-safe:animate-pulse bg-run",
  live: "motion-safe:animate-pulse bg-ok",
  error: "bg-err",
}

export function OfficeHud({
  project,
  roles,
  selectedRole,
  onSelectRole,
  connection,
  elapsedLabel,
}: {
  project: Project
  roles: string[]
  selectedRole: string | null
  onSelectRole: (role: string) => void
  connection: ConnectionState
  elapsedLabel: string
}) {
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [selectedFlow, setSelectedFlow] = useState("")
  const { flows, fallbackFlows, unavailable } = useFlowCatalog(project.id)
  const isRunning = project.state === "running"
  const doneTasks = project.tasks.filter((t) => t.status === "done").length
  const activeFeature = project.features.find((f) => f.status === "in_progress")

  const flowNames = flows ? flows.map((f) => f.name) : [...fallbackFlows]
  const effectiveFlow = selectedFlow || (flowNames[0] ?? "factory")

  useEffect(() => {
    if (!isRunning) return
    let cancelled = false
    fetch(`/api/control-plane/runs?project=${project.id}&state=running`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((runs: Array<{ id: string }>) => {
        if (!cancelled) setActiveRunId(runs[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setActiveRunId(null)
      })
    return () => {
      cancelled = true
    }
  }, [isRunning, project.id])

  const effectiveRunId = isRunning ? activeRunId : null

  async function launch() {
    setLaunching(true)
    try {
      const body =
        unavailable && effectiveFlow === "factory"
          ? { kind: "factory" }
          : { kind: "flow", flow: effectiveFlow, inputs: {} }
      await fetch(`/api/control-plane/projects/${project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    } finally {
      setLaunching(false)
    }
  }

  async function stop() {
    if (!effectiveRunId) return
    setStopping(true)
    try {
      await fetch(`/api/control-plane/runs/${effectiveRunId}/stop`, { method: "POST" })
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 bg-[#15102b] px-4 py-3 font-mono text-xs text-white/80">
      <span className="font-semibold text-white">{project.name}</span>
      {activeFeature && (
        <span className="text-white/60">
          {activeFeature.title} · {activeFeature.branch}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {roles.map((role) => {
          const identity = roleIdentity(role)
          return (
            <button
              key={role}
              onClick={() => onSelectRole(role)}
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors",
                selectedRole === role ? "border-white/60" : "border-white/10 hover:border-white/30",
              )}
              style={{ color: identity.color }}
            >
              {identity.label}
            </button>
          )
        })}
      </div>

      <span className="ml-auto text-white/60">
        {doneTasks}/{project.tasks.length} tasks
      </span>
      <span className="text-warn">${project.cost_usd.toFixed(2)}</span>
      <span className="text-white/60">{elapsedLabel}</span>

      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", CONNECTION_DOT[connection])} />
        {CONNECTION_LABEL[connection]}
      </span>

      {isRunning ? (
        <Button
          size="sm"
          variant="outline"
          className="font-mono text-xs"
          onClick={stop}
          disabled={stopping || !effectiveRunId}
        >
          <Square className="h-3.5 w-3.5" />
          {stopping ? "stopping…" : "Stop"}
        </Button>
      ) : (
        <div className="flex items-center gap-1">
          {flowNames.length > 1 && (
            <select
              value={effectiveFlow}
              onChange={(e) => setSelectedFlow(e.target.value)}
              disabled={launching}
              className="rounded-lg border border-white/20 bg-transparent px-1.5 py-1 font-mono text-[10px] text-white/70 outline-none focus:border-white/40 disabled:opacity-50"
            >
              {flowNames.map((name) => (
                <option key={name} value={name} className="bg-[#15102b]">
                  {name}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" className="font-mono text-xs" disabled={launching} onClick={launch}>
            <Play className="h-3.5 w-3.5" />
            {launching ? "launching…" : "Run flow"}
          </Button>
        </div>
      )}
    </div>
  )
}
