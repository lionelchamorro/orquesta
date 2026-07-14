import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { buildBreadcrumb, breadcrumbText, isDirtySteps } from "@/lib/flow-breadcrumb"
import { getStepAt, removeStepAt, updateStepAt } from "@/lib/flow-steps"

// Fixture: 3-level structure mirroring a factory-style flow
//   steps[0]         = command "go build ./..."
//   steps[1]         = loop {tasks} as feature
//   steps[1].body[0] = retry_until {verified}
//   steps[1].body[0].body[0] = agent coder
//   steps[1].body[0].body[1] = agent verifier
//   steps[2]         = eval {result.pass}
const steps: FlowStep[] = [
  { type: "command", command: "go build ./..." },
  {
    type: "loop",
    iterator: "{tasks}",
    as: "feature",
    body: [
      {
        type: "retry_until",
        condition: "{verified}",
        max_retries: 3,
        body: [
          { type: "agent", agent: "coder" },
          { type: "agent", agent: "verifier" },
        ],
      },
    ],
  },
  { type: "eval", expression: "{result.pass}" },
]

// ---------------------------------------------------------------------------
// buildBreadcrumb
// ---------------------------------------------------------------------------

describe("buildBreadcrumb", () => {
  it("returns only the flow segment when path is empty", () => {
    const result = buildBreadcrumb(steps, [], "factory")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ label: "factory", path: [] })
  })

  it("returns one segment for a top-level step (no flow name)", () => {
    const result = buildBreadcrumb(steps, [0])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ label: "command go build ./...", path: [0] })
  })

  it("includes flow name as root segment when provided", () => {
    const result = buildBreadcrumb(steps, [0], "factory")
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ label: "factory", path: [] })
    expect(result[1].label).toBe("command go build ./...")
  })

  it("builds a full chain for a step nested two levels deep", () => {
    // path [1, 0, 0] = steps[1].body[0].body[0] = agent coder
    const result = buildBreadcrumb(steps, [1, 0, 0], "factory")
    expect(result).toHaveLength(4)
    expect(result.map((s) => s.label)).toEqual([
      "factory",
      "loop {tasks} as feature",
      "retry_until {verified}",
      "agent coder",
    ])
    expect(result.map((s) => s.path)).toEqual([[], [1], [1, 0], [1, 0, 0]])
  })

  it("stops at the container for a path terminating at depth 1", () => {
    const result = buildBreadcrumb(steps, [1, 0], "factory")
    expect(result.map((s) => s.label)).toEqual([
      "factory",
      "loop {tasks} as feature",
      "retry_until {verified}",
    ])
  })

  it("uses just the type label when stepSummary returns an empty string", () => {
    // retry_until with no condition → stepSummary returns ""
    const plain: FlowStep[] = [{ type: "retry_until", max_retries: 3 }]
    const result = buildBreadcrumb(plain, [0])
    expect(result[0].label).toBe("retry_until")
  })
})

// ---------------------------------------------------------------------------
// breadcrumbText
// ---------------------------------------------------------------------------

describe("breadcrumbText", () => {
  it("formats segments with › separator", () => {
    const text = breadcrumbText(steps, [1, 0, 0], "factory")
    expect(text).toBe(
      "factory › loop {tasks} as feature › retry_until {verified} › agent coder",
    )
  })

  it("returns just the flow name when path is empty", () => {
    expect(breadcrumbText(steps, [], "factory")).toBe("factory")
  })
})

// ---------------------------------------------------------------------------
// isDirtySteps
// ---------------------------------------------------------------------------

describe("isDirtySteps", () => {
  it("is not dirty when both references are identical", () => {
    expect(isDirtySteps(steps, steps)).toBe(false)
  })

  it("is not dirty for a deep clone with identical values", () => {
    const clone = JSON.parse(JSON.stringify(steps)) as FlowStep[]
    expect(isDirtySteps(steps, clone)).toBe(false)
  })

  it("is dirty after editing a top-level step", () => {
    const edited = updateStepAt(steps, [0], { command: "go test ./..." })
    expect(isDirtySteps(steps, edited)).toBe(true)
  })

  it("is dirty after editing a step two levels deep", () => {
    const edited = updateStepAt(steps, [1, 0, 0], { agent: "tester" })
    expect(isDirtySteps(steps, edited)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Form view nested editing — verifies that updateStepAt at depth 2 is the
// mechanism the recursive FormView relies on for its onChange handlers.
// ---------------------------------------------------------------------------

describe("form view nested edit logic", () => {
  it("edits a step two levels deep without mutating the original", () => {
    const updated = updateStepAt(steps, [1, 0, 0], { agent: "tester" })
    expect(getStepAt(updated, [1, 0, 0])?.agent).toBe("tester")
    // Original is unchanged
    expect(getStepAt(steps, [1, 0, 0])?.agent).toBe("coder")
    // Untouched branches share references (structural sharing)
    expect(updated[0]).toBe(steps[0])
    expect(updated[2]).toBe(steps[2])
  })

  it("changes the type of a nested step at depth 2", () => {
    const updated = updateStepAt(steps, [1, 0, 1], { type: "action", action: "lint" })
    const edited = getStepAt(updated, [1, 0, 1])
    expect(edited?.type).toBe("action")
    expect(edited?.action).toBe("lint")
    // Sibling at [1, 0, 0] is untouched
    expect(getStepAt(updated, [1, 0, 0])?.agent).toBe("coder")
  })

  it("removing a step at depth 2 shrinks the nested body", () => {
    const updated = removeStepAt(steps, [1, 0, 0])
    const body = getStepAt(updated, [1, 0])?.body
    expect(body).toHaveLength(1)
    expect(body?.[0]?.agent).toBe("verifier")
  })
})
