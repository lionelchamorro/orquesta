import { describe, expect, it } from "vitest"
import {
  GLOBAL_SCOPE,
  conversationId,
  projectContextHint,
  scopeLabel,
  scopeSuggestions,
  sessionStorageKey,
  type ChatScope,
} from "@/lib/chat-scope"

const PROJECT_SCOPE: ChatScope = { kind: "project", projectId: "prm" }

describe("sessionStorageKey", () => {
  it("returns the legacy key for global scope", () => {
    expect(sessionStorageKey(GLOBAL_SCOPE)).toBe("orquesta.chat.session")
  })

  it("returns a namespaced key for project scope", () => {
    expect(sessionStorageKey(PROJECT_SCOPE)).toBe("orquesta.chat.session.project:prm")
  })

  it("different projects produce different keys", () => {
    const a = sessionStorageKey({ kind: "project", projectId: "alpha" })
    const b = sessionStorageKey({ kind: "project", projectId: "beta" })
    expect(a).not.toBe(b)
    expect(a).toContain("alpha")
    expect(b).toContain("beta")
  })

  it("project key never collides with global key", () => {
    const global = sessionStorageKey(GLOBAL_SCOPE)
    const project = sessionStorageKey({ kind: "project", projectId: "anysuffix" })
    expect(project).not.toBe(global)
  })
})

describe("conversationId", () => {
  it("returns 'global' for global scope", () => {
    expect(conversationId(GLOBAL_SCOPE)).toBe("global")
  })

  it("returns 'project:{id}' for project scope", () => {
    expect(conversationId(PROJECT_SCOPE)).toBe("project:prm")
  })

  it("global and project conversation IDs are always distinct", () => {
    expect(conversationId(GLOBAL_SCOPE)).not.toBe(conversationId(PROJECT_SCOPE))
  })
})

describe("scopeLabel", () => {
  it("labels global scope as the agent name", () => {
    expect(scopeLabel(GLOBAL_SCOPE)).toBe("Orquesta agent")
  })

  it("labels project scope with the project id", () => {
    expect(scopeLabel(PROJECT_SCOPE)).toMatch(/prm/)
    expect(scopeLabel({ kind: "project", projectId: "atlas" })).toMatch(/atlas/)
  })
})

describe("scopeSuggestions", () => {
  it("global suggestions are cross-project in nature", () => {
    const chips = scopeSuggestions(GLOBAL_SCOPE)
    expect(chips.length).toBeGreaterThan(0)
    // Verify cross-project content (mention multiple projects or broad actions)
    expect(chips.some((c) => c.toLowerCase().includes("project"))).toBe(true)
  })

  it("project suggestions reference the active project id", () => {
    const chips = scopeSuggestions(PROJECT_SCOPE)
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((c) => c.includes("prm"))).toBe(true)
  })

  it("global and project suggestions are distinct", () => {
    const global = new Set(scopeSuggestions(GLOBAL_SCOPE))
    const project = new Set(scopeSuggestions(PROJECT_SCOPE))
    const intersection = [...global].filter((c) => project.has(c))
    expect(intersection).toHaveLength(0)
  })
})

describe("projectContextHint", () => {
  it("returns null for global scope (no injection needed)", () => {
    expect(projectContextHint(GLOBAL_SCOPE)).toBeNull()
  })

  it("returns a non-null string containing the project id for project scope", () => {
    const hint = projectContextHint(PROJECT_SCOPE)
    expect(hint).not.toBeNull()
    expect(hint).toContain("prm")
  })

  it("different projects produce different hints", () => {
    const a = projectContextHint({ kind: "project", projectId: "alpha" })
    const b = projectContextHint({ kind: "project", projectId: "beta" })
    expect(a).not.toBe(b)
    expect(a).toContain("alpha")
    expect(b).toContain("beta")
  })
})
