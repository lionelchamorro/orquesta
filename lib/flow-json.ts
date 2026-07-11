// FlowDefinition ⇄ el JSON exacto que parsea el engine de orq-lite:
// {flows: {<id>: {description?, inputs?, steps}}}. Ningún campo UI-only
// (id/name/entrypoint/source) entra ni sale de este shape.
import type { FlowDefinition, FlowStep } from "@/lib/types"
import { validateFlowSteps } from "@/lib/flow-validate"

export function flowToEngineObject(flow: FlowDefinition): { flows: Record<string, unknown> } {
  return {
    flows: {
      [flow.id]: {
        description: flow.description,
        ...(flow.inputs && Object.keys(flow.inputs).length > 0 ? { inputs: flow.inputs } : {}),
        steps: flow.steps,
      },
    },
  }
}

export function flowToEngineJson(flow: FlowDefinition): string {
  return JSON.stringify(flowToEngineObject(flow), null, 2)
}

export type ParsedFlow =
  | { ok: true; patch: Pick<FlowDefinition, "description" | "inputs" | "steps"> }
  | { ok: false; errors: string[] }

// ast-grep-ignore
type RawEntry = { description?: string; inputs?: FlowDefinition["inputs"]; steps?: FlowStep[] }

export function parseFlowJson(text: string, flowId: string): ParsedFlow {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, errors: ["Invalid JSON: expected an object"] }
  }

  let entry: RawEntry
  const wrapper = data as { flows?: Record<string, RawEntry> }
  if (wrapper.flows && typeof wrapper.flows === "object") {
    const keys = Object.keys(wrapper.flows)
    const key = keys.includes(flowId) ? flowId : keys.length === 1 ? keys[0] : null
    if (!key) return { ok: false, errors: [`the flows wrapper does not contain '${flowId}' (has: ${keys.join(", ")})`] }
    entry = wrapper.flows[key]
  } else {
    entry = data as RawEntry
  }

  const steps = Array.isArray(entry.steps) ? entry.steps : []
  const stepErrors = validateFlowSteps(steps)
  if (stepErrors.length > 0) {
    return { ok: false, errors: stepErrors.map((e) => `${e.step}: ${e.error}`) }
  }
  return {
    ok: true,
    patch: {
      description: typeof entry.description === "string" ? entry.description : "",
      inputs: entry.inputs && typeof entry.inputs === "object" ? entry.inputs : {},
      steps,
    },
  }
}
