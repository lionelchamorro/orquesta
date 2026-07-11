import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { buildFlowGraph, NODE_H, NODE_W, nodeId, stepSummary } from "@/lib/flow-graph"

const steps: FlowStep[] = [
  { type: "command", command: "go build ./..." },
  {
    type: "loop",
    iterator: "{q}",
    as: "item",
    body: [
      { type: "agent", agent: "coder" },
      { type: "command", command: "go test ./..." },
    ],
  },
  { type: "eval", expression: "{pass}" },
]

describe("buildFlowGraph", () => {
  const { nodes, edges } = buildFlowGraph(steps)

  it("creates one node per step including nested ones", () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(["s0", "s1", "s1-0", "s1-1", "s2"])
  })

  it("marks containers and parents children to them (parents first)", () => {
    const loop = nodes.find((n) => n.id === "s1")!
    expect(loop.container).toBe(true)
    const child = nodes.find((n) => n.id === "s1-0")!
    expect(child.parentId).toBe("s1")
    expect(nodes.findIndex((n) => n.id === "s1")).toBeLessThan(nodes.findIndex((n) => n.id === "s1-0"))
  })

  it("stacks top-level siblings vertically and children relative to the parent", () => {
    const [a, loop] = [nodes.find((n) => n.id === "s0")!, nodes.find((n) => n.id === "s1")!]
    expect(a.position).toEqual({ x: 0, y: 0 })
    expect(loop.position.y).toBeGreaterThan(a.position.y + a.height)
    const c0 = nodes.find((n) => n.id === "s1-0")!
    const c1 = nodes.find((n) => n.id === "s1-1")!
    expect(c0.position.x).toBeGreaterThan(0)
    expect(c1.position.y).toBeGreaterThan(c0.position.y)
  })

  it("sizes containers to hold their children", () => {
    const loop = nodes.find((n) => n.id === "s1")!
    expect(loop.width).toBeGreaterThan(NODE_W)
    expect(loop.height).toBeGreaterThan(2 * NODE_H)
  })

  it("draws sequential edges per nesting level", () => {
    const pairs = edges.map((e) => `${e.source}->${e.target}`).sort()
    expect(pairs).toEqual(["s0->s1", "s1->s2", "s1-0->s1-1"].sort())
  })

  it("gives an empty container a placeholder slot height", () => {
    const g = buildFlowGraph([{ type: "loop", iterator: "{q}", as: "i", body: [] }])
    expect(g.nodes[0].height).toBeGreaterThanOrEqual(NODE_H)
  })
})

describe("helpers", () => {
  it("nodeId encodes the path", () => {
    expect(nodeId([1, 0])).toBe("s1-0")
  })
  it("stepSummary shows the discriminating field", () => {
    expect(stepSummary({ type: "command", command: "go test ./..." })).toBe("go test ./...")
    expect(stepSummary({ type: "agent", agent: "coder" })).toBe("coder")
    expect(stepSummary({ type: "loop", iterator: "{q}", as: "i" })).toBe("{q} as i")
  })
})
