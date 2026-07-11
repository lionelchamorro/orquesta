import { describe, expect, it } from "vitest"
import type { FlowStep } from "@/lib/types"
import { pathFromLocator, validateFlowSteps } from "@/lib/flow-validate"

describe("validateFlowSteps", () => {
  it("accepts a valid nested flow", () => {
    const steps: FlowStep[] = [
      { type: "command", command: "go test ./..." },
      { type: "loop", iterator: "{q}", as: "item", body: [{ type: "agent", agent: "coder" }] },
    ]
    expect(validateFlowSteps(steps)).toEqual([])
  })

  it("flags command steps with both or neither of command/args", () => {
    expect(validateFlowSteps([{ type: "command" }])).toEqual([
      { step: "steps[0](command)", error: "command steps require exactly one of command/args" },
    ])
    expect(validateFlowSteps([{ type: "command", command: "x", args: ["y"] }])).toHaveLength(1)
  })

  it("recurses into bodies with the backend's locator format", () => {
    const steps: FlowStep[] = [{ type: "loop", iterator: "{q}", as: "i", body: [{ type: "agent" }] }]
    expect(validateFlowSteps(steps)).toEqual([
      { step: "steps[0](loop).steps[0](agent)", error: "agent steps require 'agent'" },
    ])
  })

  it("flags loop without iterator/as, retry_until without condition, eval without expression, bad on_failure", () => {
    expect(validateFlowSteps([{ type: "loop", body: [] }])).toHaveLength(1)
    expect(validateFlowSteps([{ type: "retry_until", body: [] }])).toHaveLength(1)
    expect(validateFlowSteps([{ type: "eval" }])).toHaveLength(1)
    expect(validateFlowSteps([{ type: "command", command: "x", on_failure: "retry" as "continue" }])).toEqual([
      { step: "steps[0](command)", error: "invalid on_failure 'retry'" },
    ])
  })

  it("accepts on_failure null (backend treats None as valid)", () => {
    const step = { type: "command", command: "x", on_failure: null } as unknown as FlowStep
    expect(validateFlowSteps([step])).toEqual([])
  })
})

describe("pathFromLocator", () => {
  it("parses top-level and nested locators", () => {
    expect(pathFromLocator("steps[0](command)")).toEqual([0])
    expect(pathFromLocator("steps[1](loop).steps[0](command)")).toEqual([1, 0])
    expect(pathFromLocator("garbage")).toEqual([])
  })
})
