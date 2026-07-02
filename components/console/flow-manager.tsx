"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Braces, Copy, GitBranch, ListPlus, Play, Save, Workflow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import type { FlowDefinition, FlowStep, FlowStepType, Project, TeamDefinition } from "@/lib/types"

const stepTypes: FlowStepType[] = ["command", "agent", "action", "loop", "retry_until", "eval"]

function emptyStep(index: number): FlowStep {
  return {
    id: `step-${index}`,
    type: "command",
    label: `Step ${index}`,
    command: "orq-lite",
    args: [],
    depends_on: [],
  }
}

// Only serialize the fields the current step type actually uses, so
// flows.json does not accumulate leftovers from a previous type.
function flowStepExport(step: FlowStep): Partial<FlowStep> {
  const base: Partial<FlowStep> = {
    id: step.id,
    type: step.type,
    label: step.label,
    depends_on: step.depends_on,
    description: step.description,
    on_failure: step.on_failure || undefined,
  }
  switch (step.type) {
    case "command":
      return { ...base, command: step.command, args: step.args }
    case "agent":
      return { ...base, agent: step.agent, inputs: step.inputs, outputs: step.outputs }
    case "action":
      return { ...base, action: step.action, inputs: step.inputs, outputs: step.outputs }
    case "loop":
      return { ...base, iterator: step.iterator, as: step.as, body: step.body?.map(flowStepExport) as FlowStep[] }
    case "retry_until":
      return { ...base, condition: step.condition, max_retries: step.max_retries, body: step.body?.map(flowStepExport) as FlowStep[] }
    case "eval":
      return { ...base, expression: step.expression }
    default:
      return base
  }
}

function flowExport(flow: FlowDefinition) {
  return {
    flows: {
      [flow.id]: {
        name: flow.name,
        description: flow.description,
        team_id: flow.team_id,
        variables: flow.variables,
        inputs: flow.inputs,
        steps: flow.steps.map(flowStepExport),
      },
    },
  }
}

export function FlowManager({
  initialFlows,
  teams,
  projects,
  initialProjectId,
}: {
  initialFlows: FlowDefinition[]
  teams: TeamDefinition[]
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

  function updateStep(stepId: string, patch: Partial<FlowStep>) {
    if (!selected) return
    updateSelected({
      steps: selected.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    })
  }

  function addFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = String(data.get("id") ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
    if (!id || flows.some((flow) => flow.id === id)) return
    const next: FlowDefinition = {
      id,
      name: String(data.get("name") ?? id).trim() || id,
      description: String(data.get("description") ?? "").trim() || "Configured orq-lite flow.",
      team_id: String(data.get("team_id") ?? "default"),
      entrypoint: `orq-lite flow run ${id}`,
      variables: {},
      steps: [emptyStep(1)],
      tags: [],
      source: "mock",
    }
    setFlows((prev) => [...prev, next])
    setSelectedId(next.id)
    setAdding(false)
    setMessage("Draft flow created")
    event.currentTarget.reset()
  }

  async function saveSelected() {
    if (!selected || !projectId) return
    setMessage("Saving flow...")
    const res = await fetch(`/api/control-plane/projects/${projectId}/flows/${selected.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selected),
    })
    setMessage(res.ok ? "Saved to flows.json" : "Local draft only; control plane is not available")
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
            <input name="id" placeholder="release-train" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
            <input name="name" placeholder="Release train" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
            <select name="team_id" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
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
              <input
                value={selected.name}
                onChange={(event) => updateSelected({ name: event.target.value })}
                className="w-full bg-transparent font-mono text-xl font-semibold outline-none"
              />
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
            className="mt-4 min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Team</span>
              <select value={selected.team_id} onChange={(event) => updateSelected({ team_id: event.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Tags</span>
              <input value={selected.tags.join(", ")} onChange={(event) => updateSelected({ tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
            <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => updateSelected({ steps: [...selected.steps, emptyStep(selected.steps.length + 1)] })}>
              <ListPlus />Step
            </Button>
          </div>
          <div className="space-y-3">
            {selected.steps.map((step, index) => (
              <div key={step.id} className="rounded-lg border border-border bg-background p-4">
                <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Type</span>
                    <select
                      value={step.type}
                      onChange={(event) => updateStep(step.id, { type: event.target.value as FlowStepType })}
                      className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
                    >
                      {stepTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Label</span>
                    <input value={step.label ?? ""} onChange={(event) => updateStep(step.id, { label: event.target.value })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                </div>

                {step.type === "command" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Command</span>
                      <input value={step.command ?? ""} onChange={(event) => updateStep(step.id, { command: event.target.value })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Args</span>
                      <input value={(step.args ?? []).join(" ")} onChange={(event) => updateStep(step.id, { args: event.target.value.split(" ").filter(Boolean) })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                  </div>
                )}

                {step.type === "agent" && (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Agent role</span>
                    <input value={step.agent ?? ""} onChange={(event) => updateStep(step.id, { agent: event.target.value })} placeholder="coder" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                )}

                {step.type === "action" && (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Action</span>
                    <input value={step.action ?? ""} onChange={(event) => updateStep(step.id, { action: event.target.value })} placeholder="publish_pr" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                )}

                {step.type === "loop" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Iterator</span>
                      <input value={step.iterator ?? ""} onChange={(event) => updateStep(step.id, { iterator: event.target.value })} placeholder="{{features}}" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">As</span>
                      <input value={step.as ?? ""} onChange={(event) => updateStep(step.id, { as: event.target.value })} placeholder="feature" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                  </div>
                )}

                {step.type === "retry_until" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Condition</span>
                      <input value={step.condition ?? ""} onChange={(event) => updateStep(step.id, { condition: event.target.value })} placeholder="tests_pass" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Max retries</span>
                      <input type="number" value={step.max_retries ?? 0} onChange={(event) => updateStep(step.id, { max_retries: Number(event.target.value) })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    </label>
                  </div>
                )}

                {step.type === "eval" && (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Expression</span>
                    <input value={step.expression ?? ""} onChange={(event) => updateStep(step.id, { expression: event.target.value })} placeholder="tasks_done == tasks_total" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                )}

                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Depends on</span>
                    <input value={step.depends_on.join(", ")} onChange={(event) => updateStep(step.id, { depends_on: event.target.value.split(",").map((dep) => dep.trim()).filter(Boolean) })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">On failure</span>
                    <select value={step.on_failure ?? ""} onChange={(event) => updateStep(step.id, { on_failure: event.target.value as "" | "continue" })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
                      <option value="">stop</option>
                      <option value="continue">continue</option>
                    </select>
                  </label>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{step.depends_on.length ? step.depends_on.join(", ") : index === 0 ? "entry" : "linear"}</span>
                  <Button size="icon-xs" variant="ghost" title="Remove step" onClick={() => updateSelected({ steps: selected.steps.filter((candidate) => candidate.id !== step.id) })}><X /></Button>
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
