"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Bot, Braces, Check, Copy, ListPlus, Save, Shield, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import type { AgentDefinition, AgentProvider, Project, TeamDefinition, TeamRoleDefinition } from "@/lib/types"

const providers: AgentProvider[] = ["codex", "claude", "gemini", "opencode", "cmd"]

function teamExport(team: TeamDefinition) {
  return {
    agents: Object.fromEntries(
      team.agents.map((agent) => {
        const { id, ...rest } = agent
        return [id, rest]
      }),
    ),
    roles: Object.fromEntries(
      team.roles.map((role) => {
        const { role: name, ...rest } = role
        return [name, rest]
      }),
    ),
    limits: team.limits,
    full_test_command: team.full_test_command,
    lint_command: team.lint_command ?? "",
    conventions_file: team.conventions_file,
  }
}

export function TeamManager({
  initialTeams,
  projects = [],
  initialProjectId,
}: {
  initialTeams: TeamDefinition[]
  projects?: Project[]
  initialProjectId?: string
}) {
  const [teams, setTeams] = useState(initialTeams)
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "")
  const [selectedId, setSelectedId] = useState(initialTeams[0]?.id ?? "default")
  const [message, setMessage] = useState("")
  const selected = teams.find((team) => team.id === selectedId) ?? teams[0]
  const selectedJson = useMemo(() => JSON.stringify(selected ? teamExport(selected) : {}, null, 2), [selected])

  async function switchProject(nextProjectId: string) {
    setProjectId(nextProjectId)
    setMessage("Loading team...")
    const res = await fetch(`/api/control-plane/projects/${nextProjectId}/team`, { cache: "no-store" })
    if (!res.ok) {
      setMessage(`Could not load team for ${nextProjectId}`)
      return
    }
    const team: TeamDefinition = await res.json()
    setTeams([team])
    setSelectedId(team.id)
    setMessage("")
  }

  function updateSelected(patch: Partial<TeamDefinition>) {
    if (!selected) return
    setTeams((prev) => prev.map((team) => (team.id === selected.id ? { ...team, ...patch } : team)))
  }

  function updateAgent(agentId: string, patch: Partial<AgentDefinition>) {
    if (!selected) return
    updateSelected({ agents: selected.agents.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)) })
  }

  function updateRole(roleName: string, patch: Partial<TeamRoleDefinition>) {
    if (!selected) return
    updateSelected({ roles: selected.roles.map((role) => (role.role === roleName ? { ...role, ...patch } : role)) })
  }

  function addAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const id = String(data.get("id") ?? "").trim()
    if (!id || selected.agents.some((agent) => agent.id === id)) return
    updateSelected({
      agents: [
        ...selected.agents,
        {
          id,
          provider: String(data.get("provider") ?? "cmd") as AgentProvider,
          model: String(data.get("model") ?? "").trim() || undefined,
        },
      ],
    })
    setMessage("Draft agent added")
    event.currentTarget.reset()
  }

  function addRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const role = String(data.get("role") ?? "").trim()
    if (!role || selected.roles.some((candidate) => candidate.role === role)) return
    updateSelected({
      roles: [
        ...selected.roles,
        {
          role,
          agents: selected.agents[0] ? [selected.agents[0].id] : [],
          prompt: `prompts/${role}.md`,
          result_path: `.orquestalite/results/${role}.json`,
          timeout_seconds: 600,
        },
      ],
    })
    setMessage("Draft role added")
    event.currentTarget.reset()
  }

  async function saveSelected() {
    if (!selected || !projectId) return
    setMessage("Saving team...")
    const res = await fetch(`/api/control-plane/projects/${projectId}/team`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selected),
    })
    setMessage(res.ok ? "Saved to team.json" : "Local draft only; control plane is not available")
  }

  if (!selected) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">No team configured.</div>
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-4">
        {projects.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">Editing project</p>
            <select
              value={projectId}
              onChange={(event) => switchProject(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        )}
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">Teams</p>
          <div className="space-y-1">
            {teams.map((team) => (
              <button
                key={team.id}
                onClick={() => setSelectedId(team.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                  team.id === selected.id ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
                )}
              >
                <Users className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{team.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{team.id}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={addAgent} className="space-y-3 rounded-xl border border-border bg-card p-3">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Add agent</p>
          <input name="id" placeholder="codex_gpt5" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
          <select name="provider" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
            {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
          <input name="model" placeholder="model or command label" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
          <Button type="submit" size="sm" className="font-mono text-xs"><ListPlus />Agent</Button>
        </form>

        <form onSubmit={addRole} className="space-y-3 rounded-xl border border-border bg-card p-3">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Add role</p>
          <input name="role" placeholder="verifier" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
          <Button type="submit" size="sm" variant="outline" className="font-mono text-xs"><ListPlus />Role</Button>
        </form>
      </div>

      <div className="min-w-0 space-y-5">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} className="w-full bg-transparent font-mono text-xl font-semibold outline-none" />
              <textarea value={selected.description} onChange={(event) => updateSelected({ description: event.target.value })} className="mt-2 min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed text-muted-foreground outline-none" />
            </div>
            <Button size="sm" className="font-mono text-xs" onClick={saveSelected}><Save />Save</Button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Full test command</span>
              <input value={selected.full_test_command} onChange={(event) => updateSelected({ full_test_command: event.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Lint command</span>
              <input value={selected.lint_command ?? ""} onChange={(event) => updateSelected({ lint_command: event.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
            </label>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Bot className="h-4 w-4" />Agents</h2>
            <div className="space-y-3">
              {selected.agents.map((agent) => (
                <div key={agent.id} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium">{agent.id}</p>
                      <StatusBadge status={agent.provider} />
                    </div>
                    <Button size="icon-xs" variant="ghost" title="Remove agent" onClick={() => updateSelected({ agents: selected.agents.filter((candidate) => candidate.id !== agent.id) })}><Trash2 /></Button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <select value={agent.provider} onChange={(event) => updateAgent(agent.id, { provider: event.target.value as AgentProvider })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
                      {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                    </select>
                    <input value={agent.model ?? ""} onChange={(event) => updateAgent(agent.id, { model: event.target.value })} placeholder="model" className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Shield className="h-4 w-4" />Roles</h2>
            <div className="space-y-3">
              {selected.roles.map((role) => (
                <div key={role.role} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium">{role.role}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{role.prompt}</p>
                    </div>
                    <Button size="icon-xs" variant="ghost" title="Remove role" onClick={() => updateSelected({ roles: selected.roles.filter((candidate) => candidate.role !== role.role) })}><Trash2 /></Button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <input value={role.agents.join(", ")} onChange={(event) => updateRole(role.role, { agents: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    <input value={role.prompt} onChange={(event) => updateRole(role.role, { prompt: event.target.value })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                    <input type="number" value={role.timeout_seconds} onChange={(event) => updateRole(role.role, { timeout_seconds: Number(event.target.value) })} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Braces className="h-4 w-4" />team.json</h2>
            <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={() => navigator.clipboard?.writeText(selectedJson)}><Copy />Copy</Button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">{selectedJson}</pre>
          {message && <p className="mt-3 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-ok" />{message}</p>}
        </div>
      </div>
    </div>
  )
}
