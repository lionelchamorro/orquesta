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

describe("resolveDetail — selection → detail entity", () => {
  it("returns null when selection.kind is null (nothing selected)", () => {
    const sel: Selection = { kind: null, id: null }
    expect(resolveDetail(sel, MOCK_TEAM)).toBeNull()
  })

  it("returns { kind: 'agent', agent } for a known agent selection", () => {
    const sel: Selection = { kind: "agent", id: "codex_gpt5" }
    const result = resolveDetail(sel, MOCK_TEAM)
    expect(result).toMatchObject({ kind: "agent", agent: { id: "codex_gpt5" } })
  })

  it("returns null for an unknown agent id (no stale data leaks in)", () => {
    const sel: Selection = { kind: "agent", id: "ghost" }
    expect(resolveDetail(sel, MOCK_TEAM)).toBeNull()
  })

  it("returns the selected role only", () => {
    const sel: Selection = { kind: "role", id: "coder" }
    const result = resolveDetail(sel, MOCK_TEAM)
    expect(result).toMatchObject({ kind: "role", role: { role: "coder" } })
  })

  it("does NOT return the verifier role when coder is selected", () => {
    const sel: Selection = { kind: "role", id: "coder" }
    const result = resolveDetail(sel, MOCK_TEAM)
    // verifier must not be present anywhere in the result
    expect(JSON.stringify(result)).not.toContain("verifier")
  })

  it("returns null for an unknown role name", () => {
    const sel: Selection = { kind: "role", id: "ghost_role" }
    expect(resolveDetail(sel, MOCK_TEAM)).toBeNull()
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

describe("buildAgentFieldId — accessible label IDs", () => {
  it("returns a non-empty string", () => {
    expect(buildAgentFieldId("codex_gpt5", "provider")).toBeTruthy()
  })

  it("is stable across calls with the same args", () => {
    expect(buildAgentFieldId("codex_gpt5", "model")).toBe(
      buildAgentFieldId("codex_gpt5", "model"),
    )
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

  it("handles special characters in agent IDs safely", () => {
    const id = buildAgentFieldId("my-agent.v2", "model")
    // must not contain chars that would break an html id or a querySelector
    expect(id).toMatch(/^[a-z0-9_\-]+$/i)
  })
})

describe("buildRoleFieldId — accessible label IDs", () => {
  it("returns a non-empty string for every standard field", () => {
    expect(buildRoleFieldId("coder", "agents")).toBeTruthy()
    expect(buildRoleFieldId("coder", "prompt")).toBeTruthy()
    expect(buildRoleFieldId("coder", "timeout_seconds")).toBeTruthy()
  })

  it("is unique per role for the same field", () => {
    const a = buildRoleFieldId("coder", "prompt")
    const b = buildRoleFieldId("verifier", "prompt")
    expect(a).not.toBe(b)
  })

  it("is unique per field for the same role", () => {
    const a = buildRoleFieldId("coder", "prompt")
    const b = buildRoleFieldId("coder", "agents")
    expect(a).not.toBe(b)
  })
})

describe("teamExport — JSON tab roster content", () => {
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

  it("does not include agent.id inside the agent value (id is the map key, not a property)", () => {
    const exported = teamExport(MOCK_TEAM)
    const agentVal = exported.agents["codex_gpt5"] as Record<string, unknown>
    expect(agentVal).not.toHaveProperty("id")
  })

  it("does not include role.role inside the role value (role name is the map key)", () => {
    const exported = teamExport(MOCK_TEAM)
    const roleVal = exported.roles["coder"] as Record<string, unknown>
    expect(roleVal).not.toHaveProperty("role")
  })

  it("serialises to valid JSON", () => {
    expect(() => JSON.stringify(teamExport(MOCK_TEAM))).not.toThrow()
  })

  it("includes full_test_command at the top level", () => {
    const exported = teamExport(MOCK_TEAM)
    expect(exported.full_test_command).toBe("pnpm test")
  })
})
