import { describe, expect, it } from "vitest"
import { roleIdentity } from "../sprites"

describe("roleIdentity", () => {
  it("returns the exact gameboard.js identity for the 8 known roles", () => {
    expect(roleIdentity("planner")).toMatchObject({ label: "PLANNER", color: "#b07cff" })
    expect(roleIdentity("coder")).toMatchObject({ label: "CODER", color: "#46d39a" })
    expect(roleIdentity("orchestrator")).toMatchObject({ label: "ORCHESTRATOR", color: "#ffd84b" })
  })

  it("is case-insensitive for known roles", () => {
    expect(roleIdentity("Coder")).toEqual(roleIdentity("coder"))
    expect(roleIdentity("VERIFIER")).toEqual(roleIdentity("verifier"))
  })

  it("is deterministic: the same custom name always yields the same identity", () => {
    const first = roleIdentity("architect")
    const second = roleIdentity("architect")
    expect(first).toEqual(second)
  })

  it("gives distinct custom roles a spread of colors, not all identical", () => {
    const names = ["architect", "qa", "pm", "triage", "reproducer", "intake", "compactor", "generalist"]
    const colors = new Set(names.map((name) => roleIdentity(name).color))
    expect(colors.size).toBeGreaterThan(1)
  })

  it("labels a custom role with its uppercased name and a generic description", () => {
    const identity = roleIdentity("architect")
    expect(identity.label).toBe("ARCHITECT")
    expect(identity.desc).toBe("Custom role from team.json")
  })
})
