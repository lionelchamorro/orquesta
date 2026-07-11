import { describe, expect, it } from "vitest"
import type { FlowDefinition } from "@/lib/types"
import { flowToEngineJson, flowToEngineObject, parseFlowJson } from "@/lib/flow-json"

const flow: FlowDefinition = {
  id: "release",
  name: "release",
  description: "ship it",
  entrypoint: "orq-lite flow run release",
  inputs: { tag: { default: "v0" } },
  steps: [{ type: "command", command: "go test ./..." }],
}

describe("flowToEngineObject", () => {
  it("exports exactly the engine keys under flows.<id>", () => {
    expect(flowToEngineObject(flow)).toEqual({
      flows: { release: { description: "ship it", inputs: { tag: { default: "v0" } }, steps: flow.steps } },
    })
  })
  it("omits empty inputs", () => {
    const obj = flowToEngineObject({ ...flow, inputs: {} })
    expect(obj.flows.release).not.toHaveProperty("inputs")
  })
})

describe("parseFlowJson", () => {
  it("round-trips the exported JSON", () => {
    const parsed = parseFlowJson(flowToEngineJson(flow), "release")
    expect(parsed).toEqual({
      ok: true,
      patch: { description: "ship it", inputs: { tag: { default: "v0" } }, steps: flow.steps },
    })
  })
  it("accepts a bare entry without the flows wrapper", () => {
    const parsed = parseFlowJson(JSON.stringify({ description: "d", steps: [{ type: "eval", expression: "{x}" }] }), "release")
    expect(parsed.ok).toBe(true)
  })
  it("reports JSON syntax errors", () => {
    const parsed = parseFlowJson("{nope", "release")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/JSON/)
  })
  it("reports step validation errors with locators", () => {
    const parsed = parseFlowJson(JSON.stringify({ steps: [{ type: "agent" }] }), "release")
    expect(parsed).toEqual({ ok: false, errors: ["steps[0](agent): agent steps require 'agent'"] })
  })
  it("rejects a wrapper without the flow id and without a single entry", () => {
    const parsed = parseFlowJson(JSON.stringify({ flows: { a: { steps: [] }, b: { steps: [] } } }), "release")
    expect(parsed.ok).toBe(false)
  })
  it("rejects an entry with a missing or mistyped steps key instead of silently defaulting to []", () => {
    const parsed = parseFlowJson(JSON.stringify({ description: "x", step: [] }), "id")
    expect(parsed).toEqual({ ok: false, errors: ["'steps' must be an array"] })
  })
})
