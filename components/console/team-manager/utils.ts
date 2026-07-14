import type { AgentDefinition, SkillSummary, TeamDefinition, TeamRoleDefinition } from "@/lib/types"
import type { Selection } from "./types"

export const SKILLS_START_MARKER = "<!-- orquesta:skills start -->"
export const SKILLS_END_MARKER = "<!-- orquesta:skills end -->"

export function composeSkillPreview(skillIds: string[], skills: SkillSummary[]): string {
  if (skillIds.length === 0) return ""
  const byId = new Map(skills.map((skill) => [skill.id, skill.body]))
  const bodies = skillIds.map((skillId) => byId.get(skillId)).filter(Boolean).join("\n\n")
  return `${SKILLS_START_MARKER}\n${bodies}\n${SKILLS_END_MARKER}`
}

export function teamExport(team: TeamDefinition) {
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

/** Stable, unique id for a label/input pair inside an agent editor. */
export function buildAgentFieldId(agentId: string, field: string): string {
  return `agent-${agentId.replace(/[^a-z0-9]/gi, "_")}-${field}`
}

/** Stable, unique id for a label/input pair inside a role editor. */
export function buildRoleFieldId(roleName: string, field: string): string {
  return `role-${roleName.replace(/[^a-z0-9]/gi, "_")}-${field}`
}

/** Pure: given the current selection, resolve which entity to display in the detail panel. */
export function resolveDetail(
  selection: Selection,
  team: TeamDefinition,
):
  | { kind: "agent"; agent: AgentDefinition }
  | { kind: "role"; role: TeamRoleDefinition }
  | { kind: "new-agent" }
  | { kind: "new-role" }
  | null {
  if (selection.kind === "new-agent") return { kind: "new-agent" }
  if (selection.kind === "new-role") return { kind: "new-role" }
  if (selection.kind === "agent" && selection.id) {
    const agent = team.agents.find((a) => a.id === selection.id)
    return agent ? { kind: "agent", agent } : null
  }
  if (selection.kind === "role" && selection.id) {
    const role = team.roles.find((r) => r.role === selection.id)
    return role ? { kind: "role", role } : null
  }
  return null
}
