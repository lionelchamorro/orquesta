import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { appendToBody, getStepAt, insertStepAt, moveStep, removeStepAt, updateStepAt } from "@/lib/flow-steps"

const nested: FlowStep[] = [
  { type: "command", command: "go build ./..." },
  {
    type: "loop",
    iterator: "{features_queue}",
    as: "feature",
    body: [
      { type: "agent", agent: "coder" },
      { type: "command", command: "go test ./..." },
    ],
  },
  { type: "eval", expression: "{tester_res.pass}" },
]

describe("getStepAt", () => {
  it("resolves top-level and nested paths", () => {
    expect(getStepAt(nested, [0])?.command).toBe("go build ./...")
    expect(getStepAt(nested, [1, 1])?.command).toBe("go test ./...")
    expect(getStepAt(nested, [9])).toBeUndefined()
    expect(getStepAt(nested, [0, 0])).toBeUndefined()
  })
})

describe("updateStepAt", () => {
  it("patches a nested step immutably", () => {
    const out = updateStepAt(nested, [1, 0], { agent: "tester" })
    expect(getStepAt(out, [1, 0])?.agent).toBe("tester")
    expect(getStepAt(nested, [1, 0])?.agent).toBe("coder") // el original no cambia
    expect(out[0]).toBe(nested[0]) // ramas no tocadas se comparten
  })
})

describe("insertStepAt / removeStepAt / appendToBody", () => {
  it("inserts at a top-level position", () => {
    const out = insertStepAt(nested, [1], { type: "action", action: "lint" })
    expect(out).toHaveLength(4)
    expect(out[1].action).toBe("lint")
    expect(out[2].type).toBe("loop")
  })
  it("inserts inside a body", () => {
    const out = insertStepAt(nested, [1, 0], { type: "action", action: "pre" })
    expect(getStepAt(out, [1, 0])?.action).toBe("pre")
    expect(getStepAt(out, [1, 1])?.agent).toBe("coder")
  })
  it("removes a nested step", () => {
    const out = removeStepAt(nested, [1, 0])
    expect(getStepAt(out, [1, 0])?.command).toBe("go test ./...")
  })
  it("appends to a container body", () => {
    const out = appendToBody(nested, [1], { type: "eval", expression: "{x}" })
    expect(getStepAt(out, [1, 2])?.expression).toBe("{x}")
  })
  it("is a no-op when the target step is not a container", () => {
    const out = appendToBody(nested, [0], { type: "eval", expression: "{x}" })
    expect(out).toBe(nested)
  })
})

describe("moveStep", () => {
  it("swaps with the previous sibling", () => {
    const out = moveStep(nested, [1], -1)
    expect(out[0].type).toBe("loop")
    expect(out[1].type).toBe("command")
  })
  it("is a no-op at the boundary", () => {
    expect(moveStep(nested, [0], -1)).toEqual(nested)
    expect(moveStep(nested, [2], 1)).toEqual(nested)
  })
})
