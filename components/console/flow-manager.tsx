"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Braces, Copy, ListPlus, Play, Save, Workflow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import type { FlowDefinition, FlowStep, FlowStepType, Project } from "@/lib/types"

const stepTypes: FlowStepType[] = ["command", "agent", "action", "loop", "retry_until", "eval"]

function emptyStep(): FlowStep {
  // A valid placeholder so a brand-new draft saves; the engine rejects an empty
  // command ("command steps require exactly one of command/args").
  return { type: "command", command: "echo configure this step" }
}

// Exactly what the engine parses: {description?, inputs?, steps}. FlowStep
// carries only engine fields, so the step objects serialize as-is
// (JSON.stringify drops undefined keys).
function flowExport(flow: FlowDefinition) {
  return {
    flows: {
      [flow.id]: {
        description: flow.description,
        ...(flow.inputs && Object.keys(flow.inputs).length > 0 ? { inputs: flow.inputs } : {}),
        steps: flow.steps,
      },
    },
  }
}

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
  const selected = flows.find((flow) => flow.id === selectedId) ?? flows[0]
  const selectedJson = useMemo(() => JSON.stringify(selected ? flowExport(selected) : {}, null, 2), [selected])

  async function switchProject(nextProjectId: string) {
    setProjectId(nextProjectId)
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

  function updateStep(index: number, patch: Partial<FlowStep>) {
    if (!selected) return
    updateSelected({
      steps: selected.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    })
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
      // Surface the real validation error (e.g. an invalid step) instead of a
      // generic "control plane is not available".
      const detail = await res.json().catch(() => null)
      const problems = Array.isArray(detail?.detail)
        ? detail.detail
            .map((d: { error?: string; msg?: string }) => d.error ?? d.msg ?? JSON.stringify(d))
            .join("; ")
        : (detail?.detail ?? `HTTP ${res.status}`)
      setMessage(`Save failed: ${problems}`)
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
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
                onClick={() => setSelectedId(flow.id)}
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

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
            <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => updateSelected({ steps: [...selected.steps, emptyStep()] })}>
              <ListPlus />Step
            </Button>
          </div>
          <div className="space-y-3">
            {selected.steps.map((step, index) => (
              <div key={index} className="rounded-lg border border-border bg-background p-4">
                <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_140px]">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Type</span>
                    <select
                      value={step.type}
                      onChange={(event) => updateStep(index, { type: event.target.value as FlowStepType })}
                      className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
                    >
                      {stepTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end font-mono text-[11px] text-muted-foreground">
                    step {index + 1} of {selected.steps.length}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">On failure</span>
                    <select value={step.on_failure ?? ""} onChange={(event) => updateStep(index, { on_failure: event.target.value as "" | "continue" })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
                      <option value="">stop</option>
                      <option value="continue">continue</option>
                    </select>
                  </label>
                </div>

                {step.type === "command" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Command (shell string)</span>
                      <input value={step.command ?? ""} onChange={(event) => { const value = event.target.value; updateStep(index, { command: value || undefined, args: value ? undefined : step.args }) }} placeholder="go test ./..." className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Args (argv, alternative to command)</span>
                      <input value={(step.args ?? []).join(" ")} onChange={(event) => { const args = event.target.value.split(" ").filter(Boolean); updateStep(index, { args: args.length > 0 ? args : undefined, command: args.length > 0 ? undefined : step.command }) }} placeholder="git push -u origin branch" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <p className="col-span-full font-mono text-[11px] text-muted-foreground">The engine requires exactly one of command / args — filling one clears the other.</p>
                  </div>
                )}

                {step.type === "agent" && (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Agent role</span>
                    <input value={step.agent ?? ""} onChange={(event) => updateStep(index, { agent: event.target.value })} placeholder="coder" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                )}

                {step.type === "action" && (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Action</span>
                    <input value={step.action ?? ""} onChange={(event) => updateStep(index, { action: event.target.value })} placeholder="factory_extract_features" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                )}

                {step.type === "loop" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Iterator</span>
                      <input value={step.iterator ?? ""} onChange={(event) => updateStep(index, { iterator: event.target.value })} placeholder="{features_queue}" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">As</span>
                      <input value={step.as ?? ""} onChange={(event) => updateStep(index, { as: event.target.value })} placeholder="feature" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                  </div>
                )}

                {step.type === "retry_until" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Condition</span>
                      <input value={step.condition ?? ""} onChange={(event) => updateStep(index, { condition: event.target.value })} placeholder="{task_verified} == true" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Max retries</span>
                      <input type="number" value={step.max_retries ?? 1} onChange={(event) => updateStep(index, { max_retries: Number(event.target.value) })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                  </div>
                )}

                {step.type === "eval" && (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Expression</span>
                    <input value={step.expression ?? ""} onChange={(event) => updateStep(index, { expression: event.target.value })} placeholder="{lint_res.pass} && {tester_res.pass}" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                )}

                {(step.type === "loop" || step.type === "retry_until") && step.body && step.body.length > 0 && (
                  <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                    {step.body.length} nested step{step.body.length === 1 ? "" : "s"} — edit the body via the JSON export below.
                  </p>
                )}

                <div className="mt-3 flex justify-end">
                  <Button size="icon-xs" variant="ghost" title="Remove step" onClick={() => updateSelected({ steps: selected.steps.filter((_, i) => i !== index) })}><X /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Braces className="h-4 w-4" />Export</h2>
            <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={() => navigator.clipboard?.writeText(selectedJson)}><Copy />Copy</Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">{selectedJson}</pre>
          {message && <p className="mt-3 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground"><Play className="h-3.5 w-3.5 text-primary" />{message}</p>}
        </div>
      </div>
    </div>
  )
}
