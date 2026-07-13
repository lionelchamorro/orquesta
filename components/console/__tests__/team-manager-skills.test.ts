import { describe, expect, it } from "vitest"
import { SKILLS_END_MARKER, SKILLS_START_MARKER, composeSkillPreview } from "../team-manager"

describe("composeSkillPreview", () => {
  it("renders the managed prompt block in selected order", () => {
    const preview = composeSkillPreview(["dynamic-skill", "second-skill"], [
      {
        id: "second-skill",
        name: "Second Skill",
        description: "Second description",
        suggested_roles: ["coder"],
        body: "Second fetched body",
      },
      {
        id: "dynamic-skill",
        name: "Dynamic Skill",
        description: "Dynamic description",
        suggested_roles: ["coder"],
        body: "Fetched body from API",
      },
    ])

    expect(preview).toContain(SKILLS_START_MARKER)
    expect(preview).toContain(SKILLS_END_MARKER)
    expect(preview).toContain("Fetched body from API")
    expect(preview.indexOf("Fetched body from API")).toBeLessThan(
      preview.indexOf("Second fetched body"),
    )
  })

  it("returns an empty preview when no skills are selected", () => {
    expect(composeSkillPreview([], [])).toBe("")
  })
})
