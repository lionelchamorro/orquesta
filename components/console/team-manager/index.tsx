"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Bot, ListPlus, Save, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { normalizeError } from "@/lib/error-message"
import { useToast } from "@/lib/toast"
import type {
  AgentDefinition,
  AgentProvider,
  Project,
  SkillSummary,
  SkillsResponse,
  TeamDefinition,
  TeamRoleDefinition,
} from "@/lib/types"
import { RosterPanel } from "./roster-panel"
import { AgentEditor } from "./agent-editor"
import { RoleEditor } from "./role-editor"
import { JsonTab } from "./json-tab"
import { resolveDetail } from "./utils"
import type { Selection } from "./types"

// Re-export public constants and helpers so the existing test import
// `from "../team-manager"` still resolves correctly.
export { SKILLS_START_MARKER, SKILLS_END_MARKER, composeSkillPreview } from "./utils"

const PROVIDERS: AgentProvider[] = ["codex", "claude", "gemini", "opencode", "cmd"]

export function TeamManager({
  initialTeams,
  projects = [],
  initialProjectId,
}: {
  initialTeams: TeamDefinition[]
  projects?: Project[]
  initialProjectId?: string
}) {
  const toast = useToast()
  const [teams, setTeams] = useState(initialTeams)
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "")
  const [selectedTeamId, setSelectedTeamId] = useState(initialTeams[0]?.id ?? "default")
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null })
  const [tab, setTab] = useState<"form" | "json">("form")
  const [skills, setSkills] = useState<SkillSummary[]>([])

  const selected = teams.find((t) => t.id === selectedTeamId) ?? teams[0]
  const detail = selected ? resolveDetail(selection, selected) : null

  useEffect(() => {
    let cancelled = false
    async function loadSkills() {
      const res = await fetch("/api/control-plane/skills", { cache: "no-store" })
      if (!res.ok) return
      const body: SkillsResponse = await res.json()
      if (!cancelled) setSkills(body.skills)
    }
    loadSkills()
    return () => {
      cancelled = true
    }
  }, [])

  async function switchProject(nextProjectId: string) {
    setProjectId(nextProjectId)
    setSelection({ kind: null, id: null })
    const res = await fetch(`/api/control-plane/projects/${nextProjectId}/team`, {
      cache: "no-store",
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const { message, detail } = normalizeError(body ?? new Error(`HTTP ${res.status}`))
      toast.error(message, detail)
      return
    }
    const team: TeamDefinition = await res.json()
    setTeams([team])
    setSelectedTeamId(team.id)
  }

  function updateSelected(patch: Partial<TeamDefinition>) {
    if (!selected) return
    setTeams((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)))
  }

  function updateAgent(agentId: string, patch: Partial<AgentDefinition>) {
    if (!selected) return
    updateSelected({
      agents: selected.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
    })
  }

  function updateRole(roleName: string, patch: Partial<TeamRoleDefinition>) {
    if (!selected) return
    updateSelected({
      roles: selected.roles.map((r) => (r.role === roleName ? { ...r, ...patch } : r)),
    })
  }

  function addAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const id = String(data.get("id") ?? "").trim()
    if (!id || selected.agents.some((a) => a.id === id)) return
    const newAgent: AgentDefinition = {
      id,
      provider: String(data.get("provider") ?? "cmd") as AgentProvider,
      model: String(data.get("model") ?? "").trim() || undefined,
    }
    updateSelected({ agents: [...selected.agents, newAgent] })
    toast.success("Draft agent added")
    event.currentTarget.reset()
    setSelection({ kind: "agent", id })
  }

  function addRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const role = String(data.get("role") ?? "").trim()
    if (!role || selected.roles.some((r) => r.role === role)) return
    const newRole: TeamRoleDefinition = {
      role,
      agents: selected.agents[0] ? [selected.agents[0].id] : [],
      prompt: `prompts/${role}.md`,
      result_path: `.orquestalite/results/${role}.json`,
      timeout_seconds: 600,
    }
    updateSelected({ roles: [...selected.roles, newRole] })
    toast.success("Draft role added")
    event.currentTarget.reset()
    setSelection({ kind: "role", id: role })
  }

  async function saveSelected() {
    if (!selected || !projectId) return
    try {
      const res = await fetch(`/api/control-plane/projects/${projectId}/team`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      })
      if (res.ok) {
        toast.success("Saved to team.json")
      } else {
        const body = await res.json().catch(() => null)
        const { message, detail } = normalizeError(body ?? new Error(`HTTP ${res.status}`))
        toast.error(message, detail)
      }
    } catch (err) {
      const { message, detail } = normalizeError(err)
      toast.error(message, detail)
    }
  }

  if (!selected) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        No team configured.
      </div>
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <RosterPanel
        teams={teams}
        selectedTeamId={selectedTeamId}
        projects={projects}
        projectId={projectId}
        selection={selection}
        onSelectTeam={setSelectedTeamId}
        onSwitchProject={switchProject}
        onSelectAgent={(id) => setSelection({ kind: "agent", id })}
        onSelectRole={(id) => setSelection({ kind: "role", id })}
        onNewAgent={() => setSelection({ kind: "new-agent", id: null })}
        onNewRole={() => setSelection({ kind: "new-role", id: null })}
      />

      <div className="min-w-0 space-y-5">
        {/* Team header — always visible */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="team-name" className="sr-only">
                Team name
              </label>
              <input
                id="team-name"
                value={selected.name}
                onChange={(e) => updateSelected({ name: e.target.value })}
                className="w-full bg-transparent font-mono text-xl font-semibold outline-none"
              />
              <label htmlFor="team-description" className="sr-only">
                Team description
              </label>
              <textarea
                id="team-description"
                value={selected.description}
                onChange={(e) => updateSelected({ description: e.target.value })}
                className="mt-2 min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed text-muted-foreground outline-none"
              />
            </div>
            <Button size="sm" className="font-mono text-xs" onClick={saveSelected}>
              <Save />
              Save
            </Button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                Full test command
              </span>
              <input
                value={selected.full_test_command}
                onChange={(e) => updateSelected({ full_test_command: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                Lint command
              </span>
              <input
                value={selected.lint_command ?? ""}
                onChange={(e) => updateSelected({ lint_command: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
              />
            </label>
          </div>
        </div>

        {/* Form / JSON tab strip */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 font-mono text-xs">
          {(["form", "json"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                tab === t
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "form" ? "Form" : "JSON"}
            </button>
          ))}
        </div>

        {/* JSON tab */}
        {tab === "json" && <JsonTab team={selected} />}

        {/* Form tab — one entity at a time */}
        {tab === "form" && (
          <div className="rounded-xl border border-border bg-card p-5">
            {detail?.kind === "new-agent" && (
              <form onSubmit={addAgent} className="space-y-4">
                <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Bot className="h-4 w-4" />
                  New Agent
                </h2>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="new-agent-id"
                    className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Agent ID
                  </label>
                  <input
                    id="new-agent-id"
                    name="id"
                    placeholder="codex_gpt5"
                    className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="new-agent-provider"
                    className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Provider
                  </label>
                  <select
                    id="new-agent-provider"
                    name="provider"
                    className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="new-agent-model"
                    className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Model / command label
                  </label>
                  <input
                    id="new-agent-model"
                    name="model"
                    placeholder="e.g. claude-opus-4"
                    className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
                  />
                </div>
                <Button type="submit" size="sm" className="font-mono text-xs">
                  <ListPlus />
                  Add Agent
                </Button>
              </form>
            )}

            {detail?.kind === "new-role" && (
              <form onSubmit={addRole} className="space-y-4">
                <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Shield className="h-4 w-4" />
                  New Role
                </h2>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="new-role-name"
                    className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Role name
                  </label>
                  <input
                    id="new-role-name"
                    name="role"
                    placeholder="verifier"
                    className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
                  />
                </div>
                <Button type="submit" size="sm" variant="outline" className="font-mono text-xs">
                  <ListPlus />
                  Add Role
                </Button>
              </form>
            )}

            {detail?.kind === "agent" && (
              <AgentEditor
                agent={detail.agent}
                onUpdate={(patch) => updateAgent(detail.agent.id, patch)}
                onDelete={() => {
                  updateSelected({
                    agents: selected.agents.filter((a) => a.id !== detail.agent.id),
                  })
                  setSelection({ kind: null, id: null })
                }}
              />
            )}

            {detail?.kind === "role" && (
              <RoleEditor
                role={detail.role}
                agents={selected.agents}
                skills={skills}
                onUpdate={(patch) => updateRole(detail.role.role, patch)}
                onDelete={() => {
                  updateSelected({
                    roles: selected.roles.filter((r) => r.role !== detail.role.role),
                  })
                  setSelection({ kind: null, id: null })
                }}
              />
            )}

            {!detail && (
              <p className="text-sm text-muted-foreground">
                Select an agent or role from the roster to edit it, or use the{" "}
                <strong className="font-mono">+</strong> buttons to add new ones.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
