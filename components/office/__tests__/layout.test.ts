import { describe, expect, it } from "vitest"
import { layoutDesks } from "../layout"

const KNOWN_ROLES = ["planner", "parser", "coder", "tester", "critic", "reviewer", "verifier"]

function centerOf(desk: { x: number; y: number; hub: boolean }) {
  return { cx: desk.x + (desk.hub ? 62 : 60), cy: desk.y + (desk.hub ? 66 : 72) }
}

function distance(a: { cx: number; cy: number }, b: { cx: number; cy: number }) {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy)
}

describe("layoutDesks", () => {
  it("places the 7 known roles + hub at the exact gameboard.js positions", () => {
    const desks = layoutDesks(KNOWN_ROLES)
    expect(desks).toHaveLength(8)

    const byRole = Object.fromEntries(desks.map((d) => [d.role, d]))
    expect(byRole.orchestrator).toMatchObject({ x: 410, y: 248, hub: true })
    expect(byRole.planner).toMatchObject({ x: 66, y: 64, hub: false })
    expect(byRole.parser).toMatchObject({ x: 410, y: 48, hub: false })
    expect(byRole.coder).toMatchObject({ x: 754, y: 64, hub: false })
    expect(byRole.tester).toMatchObject({ x: 790, y: 248, hub: false })
    expect(byRole.critic).toMatchObject({ x: 754, y: 438, hub: false })
    expect(byRole.reviewer).toMatchObject({ x: 410, y: 470, hub: false })
    expect(byRole.verifier).toMatchObject({ x: 66, y: 438, hub: false })
  })

  it("returns only the hub when there are no roles", () => {
    const desks = layoutDesks([])
    expect(desks).toHaveLength(1)
    expect(desks[0]).toMatchObject({ role: "orchestrator", hub: true })
  })

  it("does not duplicate the hub if 'orchestrator' is passed in roles", () => {
    const desks = layoutDesks(["orchestrator", "planner"])
    expect(desks.filter((d) => d.hub)).toHaveLength(1)
    expect(desks).toHaveLength(2)
  })

  it("places 12 custom roles around the hub with no overlap and hub centered", () => {
    const customRoles = Array.from({ length: 12 }, (_, i) => `custom-role-${i}`)
    const desks = layoutDesks(customRoles)
    expect(desks).toHaveLength(13) // 12 + hub

    const hub = desks.find((d) => d.hub)!
    expect(hub).toMatchObject({ x: 410, y: 248 })

    const centers = desks.map(centerOf)
    for (let i = 0; i < centers.length; i += 1) {
      for (let j = i + 1; j < centers.length; j += 1) {
        expect(distance(centers[i], centers[j])).toBeGreaterThanOrEqual(130)
      }
    }
  })

  it("deduplicates repeated role names", () => {
    const desks = layoutDesks(["coder", "coder", "coder"])
    expect(desks).toHaveLength(2) // coder + hub
  })
})
