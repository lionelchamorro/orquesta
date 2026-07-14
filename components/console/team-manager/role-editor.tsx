"use client"

import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AgentDefinition, SkillSummary, TeamRoleDefinition } from "@/lib/types"
import { buildRoleFieldId } from "./utils"
import { SkillsPicker } from "./skills-picker"

interface RoleEditorProps {
  role: TeamRoleDefinition
  agents: AgentDefinition[]
  skills: SkillSummary[]
  onUpdate: (patch: Partial<TeamRoleDefinition>) => void
  onDelete: () => void
}

export function RoleEditor({ role, agents, skills, onUpdate, onDelete }: RoleEditorProps) {
  const fid = (field: string) => buildRoleFieldId(role.role, field)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="truncate font-mono text-base font-semibold">{role.role}</p>
        <Button size="icon-xs" variant="ghost" title="Remove role" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={fid("agents")}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Agents (comma-separated)
        </label>
        <input
          id={fid("agents")}
          value={role.agents.join(", ")}
          onChange={(e) =>
            onUpdate({
              agents: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder={agents[0]?.id ?? "agent_id"}
          className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={fid("prompt")}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Prompt path
        </label>
        <input
          id={fid("prompt")}
          value={role.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="prompts/coder.md"
          className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={fid("timeout_seconds")}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Token budget / timeout (seconds)
        </label>
        <input
          id={fid("timeout_seconds")}
          type="number"
          value={role.timeout_seconds}
          onChange={(e) => onUpdate({ timeout_seconds: Number(e.target.value) })}
          className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
        />
      </div>

      <SkillsPicker
        skills={skills}
        selected={role.skills ?? []}
        onChange={(ids) => onUpdate({ skills: ids })}
        labelPrefix={fid("skill")}
      />
    </div>
  )
}
