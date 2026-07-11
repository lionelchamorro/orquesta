"use client"

import { useState, type FormEvent } from "react"
import { Copy, ListPlus, Play, Save, Workflow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import { emptyStep, type StepPath } from "@/lib/flow-steps"
import { pathFromLocator, validateFlowSteps, type FlowStepError } from "@/lib/flow-validate"
import { FormView } from "@/components/console/flow-editor/form-view"
import { GraphView } from "@/components/console/flow-editor/graph-view"
import { JsonView } from "@/components/console/flow-editor/json-view"
import type { FlowDefinition, Project } from "@/lib/types"

export function FlowManager({
  initialFlows,
  projects,
  initialProjectId,
}: {
  initialFlows: FlowDefinition[]
  projects: Project[]
  initialProjectId?: string
}) {
  const [flows, setFlows] = useState(initialFlows)
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "")
  const [selectedId, setSelectedId] = useState(initialFlows[0]?.id ?? "")
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState("")
  const [tab, setTab] = useState<"graph" | "form" | "json">("graph")
  const [invalidPaths, setInvalidPaths] = useState<StepPath[]>([])
  const selected = flows.find((flow) => flow.id === selectedId) ?? flows[0]

  async function switchProject(nextProjectId: string) {
    setProjectId(nextProjectId)
    setInvalidPaths([])
    setMessage("Loading flows...")
    const res = await fetch(`/api/control-plane/projects/${nextProjectId}/flows`, { cache: "no-store" })
    if (!res.ok) {
      setMessage(`Could not load flows for ${nextProjectId}`)
      return
    }
    const next: FlowDefinition[] = await res.json()
    setFlows(next)
    setSelectedId(next[0]?.id ?? "")
    setMessage("")
  }

  function updateSelected(patch: Partial<FlowDefinition>) {
    if (!selected) return
    setFlows((prev) => prev.map((flow) => (flow.id === selected.id ? { ...flow, ...patch } : flow)))
  }

  function addFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = String(data.get("id") ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    if (!id || flows.some((flow) => flow.id === id)) return
    const next: FlowDefinition = {
      id,
      name: id,
      description: String(data.get("description") ?? "").trim(),
      entrypoint: `orq-lite flow run ${id}`,
      inputs: {},
      steps: [emptyStep()],
      source: "mock",
    }
    setFlows((prev) => [...prev, next])
    setSelectedId(next.id)
    setAdding(false)
    setMessage("Draft flow created")
    event.currentTarget.reset()
  }

  async function saveSelected() {
    if (!selected) return
    if (!projectId) {
      setMessage("Select a project first — flows are saved per project.")
      return
    }
    // Validación local (espejo del backend): feedback inmediato sin round-trip.
    const localErrors = validateFlowSteps(selected.steps)
    if (localErrors.length > 0) {
      applyStepErrors(localErrors)
      return
    }
    setInvalidPaths([])
    setMessage("Saving flow...")
    try {
      const res = await fetch(`/api/control-plane/projects/${projectId}/flows/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      })
      if (res.ok) {
        setMessage("Saved to flows.json")
        return
      }
      const detail = await res.json().catch(() => null)
      if (Array.isArray(detail?.detail) && detail.detail.every((d: { step?: string }) => typeof d?.step === "string")) {
        applyStepErrors(detail.detail as FlowStepError[])
        return
      }
      const problems = Array.isArray(detail?.detail)
        ? detail.detail.map((d: { error?: string; msg?: string }) => d.error ?? d.msg ?? JSON.stringify(d)).join("; ")
        : (detail?.detail ?? `HTTP ${res.status}`)
      setMessage(`Save failed: ${problems}`)
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function applyStepErrors(errors: FlowStepError[]) {
    setInvalidPaths(errors.map((e) => pathFromLocator(e.step)).filter((p) => p.length > 0))
    setMessage(`Save failed: ${errors.map((e) => `${e.step}: ${e.error}`).join("; ")}`)
  }

  if (!selected) {
    return (
      <div className="space-y-4">
        {projects.length > 0 && (
          <label className="flex max-w-xs flex-col gap-1">
            <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Project</span>
            <select
              value={projectId}
              onChange={(event) => switchProject(event.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        )}
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">No flows configured for this project.</div>
      </div>
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">flows.json</p>
            <Button size="icon-sm" variant="ghost" onClick={() => setAdding((value) => !value)} title="New flow">
              {adding ? <X /> : <ListPlus />}
            </Button>
          </div>
          <div className="space-y-1">
            {flows.map((flow) => (
              <button
                key={flow.id}
                onClick={() => {
                  setSelectedId(flow.id)
                  setInvalidPaths([])
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                  flow.id === selected.id ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
                )}
              >
                <Workflow className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{flow.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{flow.id}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {adding && (
          <form onSubmit={addFlow} className="space-y-3 rounded-xl border border-border bg-card p-3">
            <input name="id" placeholder="release_train" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
            <textarea name="description" placeholder="What this flow runs" className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50" />
            <Button type="submit" size="sm" className="font-mono text-xs"><ListPlus />Add flow</Button>
          </form>
        )}

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Editing project</p>
          <select
            value={projectId}
            onChange={(event) => switchProject(event.target.value)}
            className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <div className="mt-3 space-y-2">
            {projects.slice(0, 5).map((project) => (
              <div key={project.id} className="flex items-center justify-between gap-2 font-mono text-xs">
                <span className="truncate">{project.name}</span>
                <StatusBadge status={project.state} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-mono text-xl font-semibold">{selected.id}</h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.entrypoint}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="font-mono text-xs" title="Copy CLI command" onClick={() => navigator.clipboard?.writeText(selected.entrypoint)}>
                <Copy />CLI
              </Button>
              <Button size="sm" className="font-mono text-xs" onClick={saveSelected}>
                <Save />Save
              </Button>
            </div>
          </div>
          <textarea
            value={selected.description}
            onChange={(event) => updateSelected({ description: event.target.value })}
            placeholder="Flow description"
            className="mt-4 min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
          {selected.inputs && Object.keys(selected.inputs).length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Inputs</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(selected.inputs).map(([name, spec]) => (
                  <span key={name} className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                    {name}
                    {spec.default !== undefined && <span className="opacity-60"> = {String(spec.default)}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 font-mono text-xs">
          {(["graph", "form", "json"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                tab === t ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "graph" ? "Graph" : t === "form" ? "Form" : "JSON"}
            </button>
          ))}
        </div>

        {tab === "form" && <FormView steps={selected.steps} onChange={(steps) => {
          setInvalidPaths([])
          updateSelected({ steps })
        }} />}
        {tab === "graph" && <GraphView steps={selected.steps} onChange={(steps) => {
          setInvalidPaths([])
          updateSelected({ steps })
        }} invalidPaths={invalidPaths} />}
        {tab === "json" && (
          <JsonView
            flow={selected}
            onApply={(patch) => {
              setInvalidPaths([])
              updateSelected(patch)
            }}
          />
        )}

        {message && (
          <p className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Play className="h-3.5 w-3.5 text-primary" />{message}
          </p>
        )}
      </div>
    </div>
  )
}
