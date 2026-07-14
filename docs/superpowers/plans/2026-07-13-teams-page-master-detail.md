# Teams Page: Master-Detail Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 9,900px fully-expanded Teams page with a master-detail layout where a compact roster list on the left drives a single-entity editor on the right, with a Form/JSON tab pair.

**Architecture:** Split `components/console/team-manager.tsx` (347 lines, 1 file) into a `components/console/team-manager/` directory of 8 focused files. The `index.tsx` re-exports all public symbols so existing import paths (`"../team-manager"` in tests, `"@/components/console/team-manager"` in the page) resolve without changes. Selection state (`{ kind, id }`) drives which editor mounts; only one agent or role editor is ever in the DOM at a time.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS, lucide-react, vitest (node environment — no DOM, tests cover pure exported functions)

## Global Constraints

- **No new npm packages**: only packages already in `package.json` may be used.
- **File size limit**: 400 lines max per file (CES-71); warn at 400, error at 700.
- **Test runner**: `pnpm vitest run` (vitest 3.x, node environment — no jsdom, no @testing-library).
- **Import paths unchanged**: `import { TeamManager } from "@/components/console/team-manager"` and `import { …, composeSkillPreview } from "../team-manager"` must still work.
- **Do not touch**: `lib/types.ts`, `lib/api.ts`, `components/console/flow-editor/**`, `components/console/run-history.tsx`, `components/console/artifacts-pane.tsx`, `orquesta_api/**`, `test/test_artifacts*.py`, `BACKLOG.md`.
- **Styling**: match existing console aesthetic — Tailwind tokens from neighboring components (`bg-card`, `bg-background`, `border-border`, `font-mono text-sm`, `text-muted-foreground`, etc.).
- **Labels**: every `<input>` and `<select>` must have an associated `<label>` via `htmlFor`/`id` or an `aria-label`.
- **Preserve existing functionality**: team/project selection, save, add/delete agents and roles, skill toggling, full_test_command, lint_command, conventions_file.

---

## File Structure

| File | Responsibility | Est. lines |
|------|---------------|-----------|
| `components/console/team-manager/utils.ts` | Pure functions: `teamExport`, `composeSkillPreview`, `buildAgentFieldId`, `buildRoleFieldId` | ~50 |
| `components/console/team-manager/types.ts` | `Selection` type and `SelectionKind` union | ~20 |
| `components/console/team-manager/skills-picker.tsx` | Compact skill checkboxes with `title` tooltip on description | ~45 |
| `components/console/team-manager/agent-editor.tsx` | Labeled agent form (name, provider, model/cmd) | ~80 |
| `components/console/team-manager/role-editor.tsx` | Labeled role form (agents, prompt, timeout, skills) | ~100 |
| `components/console/team-manager/roster-panel.tsx` | Left column: project select, agents list, roles list, + buttons | ~130 |
| `components/console/team-manager/json-tab.tsx` | team.json pre-block with Copy button | ~30 |
| `components/console/team-manager/index.tsx` | Main `TeamManager` — state orchestrator, tab strip, layout | ~160 |
| (delete) `components/console/team-manager.tsx` | Replaced by the directory above | — |
| `components/console/__tests__/team-manager-master-detail.test.ts` | New tests for selection logic, label IDs, teamExport coverage | ~80 |

---

### Task 1: Extract Pure Utilities and Types

**Files:**
- Create: `components/console/team-manager/utils.ts`
- Create: `components/console/team-manager/types.ts`

**Interfaces:**
- Produces:
  - `teamExport(team: TeamDefinition): object`
  - `composeSkillPreview(skillIds: string[], skills: SkillSummary[]): string`
  - `SKILLS_START_MARKER: string`
  - `SKILLS_END_MARKER: string`
  - `buildAgentFieldId(agentId: string, field: string): string` — returns e.g. `"agent-codex_gpt5-provider"`
  - `buildRoleFieldId(roleName: string, field: string): string` — returns e.g. `"role-coder-prompt"`
  - `type SelectionKind = "agent" | "role" | "new-agent" | "new-role" | null`
  - `interface Selection { kind: SelectionKind; id: string | null }`
  - `resolveDetail(selection: Selection, team: TeamDefinition): { kind: "agent"; agent: AgentDefinition } | { kind: "role"; role: TeamRoleDefinition } | { kind: "new-agent" } | { kind: "new-role" } | null`

- [ ] **Step 1: Write `utils.ts`**

```ts
// components/console/team-manager/utils.ts
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

/** Pure: given the current selection, resolve which entity (if any) to display in the detail panel. */
export function resolveDetail(
  selection: Selection,
  team: TeamDefinition,
): { kind: "agent"; agent: AgentDefinition } | { kind: "role"; role: TeamRoleDefinition } | { kind: "new-agent" } | { kind: "new-role" } | null {
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
```

- [ ] **Step 2: Write `types.ts`**

```ts
// components/console/team-manager/types.ts
export type SelectionKind = "agent" | "role" | "new-agent" | "new-role" | null

export interface Selection {
  kind: SelectionKind
  id: string | null
}
```

- [ ] **Step 3: Verify TypeScript compiles (no errors in new files)**

```bash
cd /Users/lionelchamorro/Projects/personal/orquesta && pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: errors only from _other_ files (not from the new `utils.ts`/`types.ts`).

---

### Task 2: New Tests for Pure Utilities

**Files:**
- Create: `components/console/__tests__/team-manager-master-detail.test.ts`

**Interfaces:**
- Consumes: `teamExport`, `composeSkillPreview`, `SKILLS_START_MARKER`, `SKILLS_END_MARKER`, `buildAgentFieldId`, `buildRoleFieldId`, `resolveDetail` from `../team-manager/utils`; `Selection` from `../team-manager/types`

- [ ] **Step 1: Write failing tests first**

```ts
// components/console/__tests__/team-manager-master-detail.test.ts
import { describe, expect, it } from "vitest"
import {
  buildAgentFieldId,
  buildRoleFieldId,
  resolveDetail,
  teamExport,
} from "../team-manager/utils"
import type { Selection } from "../team-manager/types"
import type { TeamDefinition } from "@/lib/types"

const MOCK_TEAM: TeamDefinition = {
  id: "default",
  name: "Default",
  description: "Mock team",
  agents: [
    { id: "codex_gpt5", provider: "codex", model: "gpt-5" },
    { id: "claude_opus", provider: "claude", model: "claude-opus-4" },
  ],
  roles: [
    {
      role: "coder",
      agents: ["codex_gpt5"],
      prompt: "prompts/coder.md",
      result_path: ".orquestalite/results/coder.json",
      timeout_seconds: 600,
    },
    {
      role: "verifier",
      agents: ["claude_opus"],
      prompt: "prompts/verifier.md",
      result_path: ".orquestalite/results/verifier.json",
      timeout_seconds: 300,
    },
  ],
  limits: {},
  full_test_command: "pnpm test",
}

describe("resolveDetail", () => {
  it("returns null when selection.kind is null", () => {
    const sel: Selection = { kind: null, id: null }
    expect(resolveDetail(sel, MOCK_TEAM)).toBeNull()
  })

  it("returns { kind: 'agent', agent } for a known agent selection", () => {
    const sel: Selection = { kind: "agent", id: "codex_gpt5" }
    const result = resolveDetail(sel, MOCK_TEAM)
    expect(result).toMatchObject({ kind: "agent", agent: { id: "codex_gpt5" } })
  })

  it("returns null for an unknown agent id", () => {
    const sel: Selection = { kind: "agent", id: "ghost" }
    expect(resolveDetail(sel, MOCK_TEAM)).toBeNull()
  })

  it("returns { kind: 'role', role } for the selected role", () => {
    const sel: Selection = { kind: "role", id: "coder" }
    const result = resolveDetail(sel, MOCK_TEAM)
    expect(result).toMatchObject({ kind: "role", role: { role: "coder" } })
  })

  it("does NOT return the verifier role when coder is selected", () => {
    const sel: Selection = { kind: "role", id: "coder" }
    const result = resolveDetail(sel, MOCK_TEAM)
    expect(result).not.toMatchObject({ role: { role: "verifier" } })
  })

  it("returns { kind: 'new-agent' } for new-agent selection", () => {
    const sel: Selection = { kind: "new-agent", id: null }
    expect(resolveDetail(sel, MOCK_TEAM)).toEqual({ kind: "new-agent" })
  })

  it("returns { kind: 'new-role' } for new-role selection", () => {
    const sel: Selection = { kind: "new-role", id: null }
    expect(resolveDetail(sel, MOCK_TEAM)).toEqual({ kind: "new-role" })
  })
})

describe("buildAgentFieldId", () => {
  it("returns a non-empty string", () => {
    expect(buildAgentFieldId("codex_gpt5", "provider")).toBeTruthy()
  })

  it("is stable across calls with same args", () => {
    expect(buildAgentFieldId("codex_gpt5", "model")).toBe(buildAgentFieldId("codex_gpt5", "model"))
  })

  it("is unique per field within the same agent", () => {
    const a = buildAgentFieldId("codex_gpt5", "provider")
    const b = buildAgentFieldId("codex_gpt5", "model")
    expect(a).not.toBe(b)
  })

  it("is unique across agents for the same field", () => {
    const a = buildAgentFieldId("codex_gpt5", "provider")
    const b = buildAgentFieldId("claude_opus", "provider")
    expect(a).not.toBe(b)
  })
})

describe("buildRoleFieldId", () => {
  it("returns a non-empty string for each field", () => {
    expect(buildRoleFieldId("coder", "agents")).toBeTruthy()
    expect(buildRoleFieldId("coder", "prompt")).toBeTruthy()
    expect(buildRoleFieldId("coder", "timeout_seconds")).toBeTruthy()
  })

  it("is unique per role", () => {
    const a = buildRoleFieldId("coder", "prompt")
    const b = buildRoleFieldId("verifier", "prompt")
    expect(a).not.toBe(b)
  })
})

describe("teamExport", () => {
  it("includes all agents keyed by id", () => {
    const exported = teamExport(MOCK_TEAM)
    expect(Object.keys(exported.agents)).toContain("codex_gpt5")
    expect(Object.keys(exported.agents)).toContain("claude_opus")
  })

  it("includes all roles keyed by role name", () => {
    const exported = teamExport(MOCK_TEAM)
    expect(Object.keys(exported.roles)).toContain("coder")
    expect(Object.keys(exported.roles)).toContain("verifier")
  })

  it("does not include agent.id inside the agent value (id is the key)", () => {
    const exported = teamExport(MOCK_TEAM)
    const agentVal = exported.agents["codex_gpt5"] as Record<string, unknown>
    expect(agentVal).not.toHaveProperty("id")
  })

  it("produces valid JSON string", () => {
    expect(() => JSON.stringify(teamExport(MOCK_TEAM))).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests — they must fail (utils.ts not yet exported from index)**

```bash
cd /Users/lionelchamorro/Projects/personal/orquesta && pnpm vitest run components/console/__tests__/team-manager-master-detail.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../team-manager/utils'`

---

### Task 3: SkillsPicker Component

**Files:**
- Create: `components/console/team-manager/skills-picker.tsx`

**Interfaces:**
- Consumes: `SkillSummary` from `@/lib/types`
- Produces: `<SkillsPicker skills={SkillSummary[]} selected={string[]} onChange={(ids: string[]) => void} />`

- [ ] **Step 1: Write `skills-picker.tsx`**

```tsx
// components/console/team-manager/skills-picker.tsx
"use client"

import type { SkillSummary } from "@/lib/types"

interface SkillsPickerProps {
  skills: SkillSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  labelPrefix: string  // used to generate unique checkbox ids
}

export function SkillsPicker({ skills, selected, onChange, labelPrefix }: SkillsPickerProps) {
  if (skills.length === 0) return null

  function toggle(skillId: string) {
    onChange(
      selected.includes(skillId)
        ? selected.filter((s) => s !== skillId)
        : [...selected, skillId],
    )
  }

  return (
    <fieldset className="rounded-lg border border-border bg-card p-3">
      <legend className="px-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        Skills
      </legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {skills.map((skill) => {
          const checkId = `${labelPrefix}-skill-${skill.id}`
          const isChecked = selected.includes(skill.id)
          return (
            <label
              key={skill.id}
              htmlFor={checkId}
              title={skill.description}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                isChecked
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <input
                id={checkId}
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(skill.id)}
                className="sr-only"
              />
              {skill.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
```

---

### Task 4: AgentEditor Component

**Files:**
- Create: `components/console/team-manager/agent-editor.tsx`

**Interfaces:**
- Consumes: `AgentDefinition`, `AgentProvider` from `@/lib/types`; `buildAgentFieldId` from `./utils`
- Produces: `<AgentEditor agent={AgentDefinition} onUpdate={(patch) => void} onDelete={() => void} />`

- [ ] **Step 1: Write `agent-editor.tsx`**

```tsx
// components/console/team-manager/agent-editor.tsx
"use client"

import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import type { AgentDefinition, AgentProvider } from "@/lib/types"
import { buildAgentFieldId } from "./utils"

const PROVIDERS: AgentProvider[] = ["codex", "claude", "gemini", "opencode", "cmd"]

interface AgentEditorProps {
  agent: AgentDefinition
  onUpdate: (patch: Partial<AgentDefinition>) => void
  onDelete: () => void
}

export function AgentEditor({ agent, onUpdate, onDelete }: AgentEditorProps) {
  const fieldId = (field: string) => buildAgentFieldId(agent.id, field)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-base font-semibold">{agent.id}</p>
          <StatusBadge status={agent.provider} />
        </div>
        <Button size="icon-xs" variant="ghost" title="Remove agent" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={fieldId("provider")}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Provider
          </label>
          <select
            id={fieldId("provider")}
            value={agent.provider}
            onChange={(e) => onUpdate({ provider: e.target.value as AgentProvider })}
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
            htmlFor={fieldId("model")}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Model / command label
          </label>
          <input
            id={fieldId("model")}
            value={agent.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
            placeholder="e.g. claude-opus-4"
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {agent.provider === "cmd" && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={fieldId("cmd")}
            className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Command args (space-separated)
          </label>
          <input
            id={fieldId("cmd")}
            value={(agent.cmd ?? []).join(" ")}
            onChange={(e) =>
              onUpdate({
                cmd: e.target.value
                  .split(" ")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="e.g. orq-lite run"
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
          />
        </div>
      )}
    </div>
  )
}
```

---

### Task 5: RoleEditor Component

**Files:**
- Create: `components/console/team-manager/role-editor.tsx`

**Interfaces:**
- Consumes: `TeamRoleDefinition`, `AgentDefinition`, `SkillSummary` from `@/lib/types`; `buildRoleFieldId` from `./utils`; `SkillsPicker` from `./skills-picker`
- Produces: `<RoleEditor role={TeamRoleDefinition} agents={AgentDefinition[]} skills={SkillSummary[]} onUpdate={(patch) => void} onDelete={() => void} />`

- [ ] **Step 1: Write `role-editor.tsx`**

```tsx
// components/console/team-manager/role-editor.tsx
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
  const fieldId = (field: string) => buildRoleFieldId(role.role, field)

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
          htmlFor={fieldId("agents")}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Agents (comma-separated)
        </label>
        <input
          id={fieldId("agents")}
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
          htmlFor={fieldId("prompt")}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Prompt path
        </label>
        <input
          id={fieldId("prompt")}
          value={role.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="prompts/coder.md"
          className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={fieldId("timeout_seconds")}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Token budget / timeout (seconds)
        </label>
        <input
          id={fieldId("timeout_seconds")}
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
        labelPrefix={fieldId("skill")}
      />
    </div>
  )
}
```

---

### Task 6: RosterPanel Component

**Files:**
- Create: `components/console/team-manager/roster-panel.tsx`

**Interfaces:**
- Consumes: `TeamDefinition`, `Project` from `@/lib/types`; `Selection` from `./types`
- Produces: `<RosterPanel teams={} selectedTeamId={} projects={} projectId={} selection={} onSelectTeam={} onSwitchProject={} onSelectAgent={} onSelectRole={} onNewAgent={} onNewRole={} />`

- [ ] **Step 1: Write `roster-panel.tsx`**

```tsx
// components/console/team-manager/roster-panel.tsx
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
              title="Add agent"
              onClick={() =>
                selection.kind === "new-agent" ? onSelectAgent("") : onNewAgent()
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
              title="Add role"
              onClick={() =>
                selection.kind === "new-role" ? onSelectRole("") : onNewRole()
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
```

---

### Task 7: JsonTab Component

**Files:**
- Create: `components/console/team-manager/json-tab.tsx`

**Interfaces:**
- Consumes: `TeamDefinition` from `@/lib/types`; `teamExport` from `./utils`
- Produces: `<JsonTab team={TeamDefinition} />`

- [ ] **Step 1: Write `json-tab.tsx`**

```tsx
// components/console/team-manager/json-tab.tsx
"use client"

import { Braces, Copy } from "lucide-react"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import type { TeamDefinition } from "@/lib/types"
import { teamExport } from "./utils"

interface JsonTabProps {
  team: TeamDefinition
}

export function JsonTab({ team }: JsonTabProps) {
  const json = useMemo(() => JSON.stringify(teamExport(team), null, 2), [team])

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Braces className="h-4 w-4" />
          team.json
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="font-mono text-xs"
          onClick={() => navigator.clipboard?.writeText(json)}
        >
          <Copy />
          Copy
        </Button>
      </div>
      <pre className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">
        {json}
      </pre>
    </div>
  )
}
```

---

### Task 8: Main `index.tsx` — Orchestrator

**Files:**
- Create: `components/console/team-manager/index.tsx`

**Interfaces:**
- Consumes: all sub-components above; `teamExport`, `composeSkillPreview`, `SKILLS_START_MARKER`, `SKILLS_END_MARKER`, `resolveDetail` from `./utils`; `Selection` from `./types`
- Produces:
  - `export { SKILLS_START_MARKER, SKILLS_END_MARKER, composeSkillPreview }` (re-exports for test backward compat)
  - `export function TeamManager(...)` (same props as before)

- [ ] **Step 1: Write `index.tsx`**

```tsx
// components/console/team-manager/index.tsx
"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
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

// Re-export public constants so existing test import `from "../team-manager"` still works.
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

  const selected = teams.find((team) => team.id === selectedTeamId) ?? teams[0]
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
    return () => { cancelled = true }
  }, [])

  async function switchProject(nextProjectId: string) {
    setProjectId(nextProjectId)
    setSelection({ kind: null, id: null })
    const res = await fetch(`/api/control-plane/projects/${nextProjectId}/team`, { cache: "no-store" })
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
    updateSelected({ agents: selected.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)) })
  }

  function updateRole(roleName: string, patch: Partial<TeamRoleDefinition>) {
    if (!selected) return
    updateSelected({ roles: selected.roles.map((r) => (r.role === roleName ? { ...r, ...patch } : r)) })
  }

  function addAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const id = String(data.get("id") ?? "").trim()
    if (!id || selected.agents.some((a) => a.id === id)) return
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
        {/* Team header (always visible) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="team-name" className="sr-only">Team name</label>
              <input
                id="team-name"
                value={selected.name}
                onChange={(e) => updateSelected({ name: e.target.value })}
                className="w-full bg-transparent font-mono text-xl font-semibold outline-none"
              />
              <label htmlFor="team-description" className="sr-only">Team description</label>
              <textarea
                id="team-description"
                value={selected.description}
                onChange={(e) => updateSelected({ description: e.target.value })}
                className="mt-2 min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed text-muted-foreground outline-none"
              />
            </div>
            <Button size="sm" className="font-mono text-xs" onClick={saveSelected}>
              <Save />Save
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

        {tab === "json" && <JsonTab team={selected} />}

        {tab === "form" && (
          <div className="rounded-xl border border-border bg-card p-5">
            {/* New agent form */}
            {detail?.kind === "new-agent" && (
              <form onSubmit={addAgent} className="space-y-4">
                <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Bot className="h-4 w-4" />New Agent
                </h2>
                <div className="flex flex-col gap-1">
                  <label htmlFor="new-agent-id" className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Agent ID</label>
                  <input id="new-agent-id" name="id" placeholder="codex_gpt5" className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="new-agent-provider" className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Provider</label>
                  <select id="new-agent-provider" name="provider" className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50">
                    {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="new-agent-model" className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Model / command label</label>
                  <input id="new-agent-model" name="model" placeholder="e.g. claude-opus-4" className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                </div>
                <Button type="submit" size="sm" className="font-mono text-xs"><ListPlus />Add Agent</Button>
              </form>
            )}

            {/* New role form */}
            {detail?.kind === "new-role" && (
              <form onSubmit={addRole} className="space-y-4">
                <h2 className="inline-flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Shield className="h-4 w-4" />New Role
                </h2>
                <div className="flex flex-col gap-1">
                  <label htmlFor="new-role-name" className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Role name</label>
                  <input id="new-role-name" name="role" placeholder="verifier" className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" />
                </div>
                <Button type="submit" size="sm" variant="outline" className="font-mono text-xs"><ListPlus />Add Role</Button>
              </form>
            )}

            {/* Agent detail */}
            {detail?.kind === "agent" && (
              <AgentEditor
                agent={detail.agent}
                onUpdate={(patch) => updateAgent(detail.agent.id, patch)}
                onDelete={() => {
                  updateSelected({ agents: selected.agents.filter((a) => a.id !== detail.agent.id) })
                  setSelection({ kind: null, id: null })
                }}
              />
            )}

            {/* Role detail */}
            {detail?.kind === "role" && (
              <RoleEditor
                role={detail.role}
                agents={selected.agents}
                skills={skills}
                onUpdate={(patch) => updateRole(detail.role.role, patch)}
                onDelete={() => {
                  updateSelected({ roles: selected.roles.filter((r) => r.role !== detail.role.role) })
                  setSelection({ kind: null, id: null })
                }}
              />
            )}

            {/* Nothing selected */}
            {!detail && (
              <p className="text-sm text-muted-foreground">
                Select an agent or role from the roster to edit it, or use the <strong>+</strong> buttons to add new ones.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

---

### Task 9: Remove Old File and Run Verification

**Files:**
- Delete: `components/console/team-manager.tsx`

- [ ] **Step 1: Remove the old monolith**

```bash
rm /Users/lionelchamorro/Projects/personal/orquesta/components/console/team-manager.tsx
```

- [ ] **Step 2: Run existing test suite**

```bash
cd /Users/lionelchamorro/Projects/personal/orquesta && pnpm vitest run 2>&1 | tail -40
```

Expected: ALL PASS (existing `team-manager-skills.test.ts` resolves to `team-manager/index.tsx` which re-exports `SKILLS_START_MARKER`, `SKILLS_END_MARKER`, `composeSkillPreview`; new `team-manager-master-detail.test.ts` now resolves `team-manager/utils`).

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/lionelchamorro/Projects/personal/orquesta && pnpm exec tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 4: Lint**

```bash
cd /Users/lionelchamorro/Projects/personal/orquesta && pnpm lint 2>&1 | tail -20
```

Expected: zero errors (warnings acceptable if pre-existing).

---

## Self-Review Against Spec

| Requirement | Task covering it |
|-------------|----------------|
| Master-detail layout: compact roster left | Task 6 (RosterPanel) + Task 8 (index.tsx layout) |
| Add-agent / add-role become buttons in roster header | Task 6 (+ buttons in RosterPanel header) |
| One entity edited at a time | Task 8 (`resolveDetail` + conditional rendering) |
| Labels on every field: agent editor | Task 4 (AgentEditor — provider, model, cmd all labeled) |
| Labels on every field: role editor | Task 5 (RoleEditor — agents, prompt, timeout all labeled) |
| Skills as compact chips/multi-select with description as tooltip | Task 3 (SkillsPicker — chip pills with `title` attr) |
| Form / JSON tab pair (mirrors Flows pattern) | Task 8 (tab strip matching `flow-manager.tsx`) |
| JSON tab shows current team.json | Task 7 (JsonTab) |
| Copy button on JSON | Task 7 |
| Save flow preserved | Task 8 (saveSelected unchanged) |
| Add/delete agents and roles preserved | Task 8 (addAgent, addRole, onDelete handlers) |
| Skill toggling preserved | Task 3 (SkillsPicker onChange) + Task 5 (onUpdate) |
| full_test_command, lint_command inputs preserved | Task 8 (team header section) |
| Team selection per project preserved | Task 8 (switchProject) |
| File size < 400 lines each | All files ~30–160 lines |
| Existing `composeSkillPreview` tests still pass | Task 1 re-exports; Task 9 removes old file |
| New tests: selection logic | Task 2 (`resolveDetail` tests) |
| New tests: accessible labels | Task 2 (`buildAgentFieldId`, `buildRoleFieldId` tests) |
| New tests: JSON tab renders roster | Task 2 (`teamExport` tests) |
