import { describe, expect, it } from "vitest"
import { SKILLS_END_MARKER, SKILLS_START_MARKER, composeSkillPreview } from "../team-manager"

describe("composeSkillPreview", () => {
  it("renders the managed prompt block in selected order", () => {
    const preview = composeSkillPreview(["verification-evidence", "tdd-workflow"])

    expect(preview).toContain(SKILLS_START_MARKER)
    expect(preview).toContain(SKILLS_END_MARKER)
    expect(preview.indexOf("Any claim of")).toBeLessThan(
      preview.indexOf("Work in small vertical slices"),
    )
  })

  it("returns an empty preview when no skills are selected", () => {
    expect(composeSkillPreview([])).toBe("")
  })
})
