"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useOfficeData } from "@/lib/use-office-data"
import type { Project } from "@/lib/types"
import { OfficeHud } from "./hud"
import { layoutDesks } from "./layout"
import { OfficeStage } from "./office-stage"
import { RolePanel } from "./role-panel"
import { deskStatus } from "./status"

function elapsedLabel(lastRun: string): string {
  if (!lastRun) return "—"
  const started = new Date(lastRun).getTime()
  if (Number.isNaN(started)) return "—"
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

export function OfficeView({ project: initialProject, roles }: { project: Project; roles: string[] }) {
  const { project, events, connection, results, diffs, loadResult, loadDiff } =
    useOfficeData(initialProject)
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  // Ticks once a second while a run is active purely to force elapsedLabel()
  // to recompute in the render below; the value itself is never read.
  const [, forceElapsedTick] = useState(0)

  useEffect(() => {
    if (project.state !== "running") return
    const interval = setInterval(() => forceElapsedTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [project.state])

  const desks = useMemo(() => layoutDesks(roles), [roles])
  const runActive = project.state === "running"
  const statuses = useMemo(() => {
    const map: Record<string, ReturnType<typeof deskStatus>> = {}
    for (const desk of desks) {
      map[desk.role] = deskStatus(desk.role, events, runActive)
    }
    return map
    // `tick` forces recompute purely for the "workin…" pulse cadence display;
    // deskStatus itself only depends on events/runActive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desks, events, runActive])

  const currentTask = project.tasks.find((t) => t.status === "in_progress")

  if (roles.length === 0) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          This project has no team.json configured yet.
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          Run <code>orq-lite init</code> in the workspace, then reload.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#15102b] px-4 py-2">
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Console
        </Link>
      </div>
      <OfficeHud
        project={project}
        roles={desks.map((d) => d.role)}
        selectedRole={selectedRole}
        onSelectRole={setSelectedRole}
        connection={connection}
        elapsedLabel={elapsedLabel(project.last_run)}
      />
      {!runActive && (
        <p className="border-b border-white/10 bg-[#15102b] px-4 py-1.5 font-mono text-[11px] text-white/50">
          idle — last run {project.last_run || "never"}
        </p>
      )}
      <div className="flex-1 overflow-auto p-4">
        <OfficeStage
          desks={desks}
          statuses={statuses}
          selectedRole={selectedRole}
          onSelect={setSelectedRole}
        />
      </div>

      {selectedRole && (
        <RolePanel
          role={selectedRole}
          events={events}
          currentTaskId={currentTask?.id}
          result={results[selectedRole]}
          diff={currentTask ? diffs[currentTask.id] : undefined}
          onClose={() => setSelectedRole(null)}
          onOpenSummary={() => loadResult(selectedRole)}
          onOpenJson={() => loadResult(selectedRole)}
          onOpenChanges={() => {
            if (currentTask) loadDiff(currentTask.id)
          }}
        />
      )}
    </div>
  )
}
