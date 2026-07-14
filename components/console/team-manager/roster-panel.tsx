"use client"

import { Bot, ListPlus, Shield, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Project, TeamDefinition } from "@/lib/types"
import type { Selection } from "./types"

interface RosterPanelProps {
  teams: TeamDefinition[]
  selectedTeamId: string
  projects: Project[]
  projectId: string
  selection: Selection
  onSelectTeam: (id: string) => void
  onSwitchProject: (id: string) => void
  onSelectAgent: (agentId: string) => void
  onSelectRole: (roleName: string) => void
  onNewAgent: () => void
  onNewRole: () => void
}

export function RosterPanel({
  teams,
  selectedTeamId,
  projects,
  projectId,
  selection,
  onSelectTeam,
  onSwitchProject,
  onSelectAgent,
  onSelectRole,
  onNewAgent,
  onNewRole,
}: RosterPanelProps) {
  const selected = teams.find((t) => t.id === selectedTeamId) ?? teams[0]

  return (
    <div className="space-y-4">
      {projects.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <label
            htmlFor="roster-project-select"
            className="mb-2 block font-mono text-xs uppercase tracking-wide text-muted-foreground"
          >
            Editing project
          </label>
          <select
            id="roster-project-select"
            value={projectId}
            onChange={(e) => onSwitchProject(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {teams.length > 1 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Teams
          </p>
          <div className="space-y-1">
            {teams.map((team) => (
              <button
                key={team.id}
                onClick={() => onSelectTeam(team.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                  team.id === selectedTeamId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                <Users className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{team.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {team.id}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              Agents
            </p>
            <Button
              size="icon-sm"
              variant="ghost"
              title={selection.kind === "new-agent" ? "Cancel" : "Add agent"}
              onClick={() =>
                selection.kind === "new-agent"
                  ? onSelectAgent("")
                  : onNewAgent()
              }
            >
              {selection.kind === "new-agent" ? <X /> : <ListPlus />}
            </Button>
          </div>
          <div className="space-y-1">
            {selected.agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                  selection.kind === "agent" && selection.id === agent.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{agent.id}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {agent.provider}
                    {agent.model ? ` · ${agent.model}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              Roles
            </p>
            <Button
              size="icon-sm"
              variant="ghost"
              title={selection.kind === "new-role" ? "Cancel" : "Add role"}
              onClick={() =>
                selection.kind === "new-role"
                  ? onSelectRole("")
                  : onNewRole()
              }
            >
              {selection.kind === "new-role" ? <X /> : <ListPlus />}
            </Button>
          </div>
          <div className="space-y-1">
            {selected.roles.map((role) => (
              <button
                key={role.role}
                onClick={() => onSelectRole(role.role)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                  selection.kind === "role" && selection.id === role.role
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{role.role}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {role.prompt}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
