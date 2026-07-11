// Espejo client-side de orquesta_api/meta/models.py::validate_flow_steps.
// Mismas reglas y MISMO formato de locator: los 422 del PUT y los errores
// locales del editor apuntan al step con la misma string.
import type { FlowStep } from "@/lib/types"
import type { StepPath } from "@/lib/flow-steps"

export interface FlowStepError {
  step: string
  error: string
}

const STEP_TYPE_ERROR: Record<string, string> = {
  command: "command steps require exactly one of command/args",
  action: "action steps require 'action'",
  agent: "agent steps require 'agent'",
  loop: "loop steps require 'iterator' and 'as'",
  retry_until: "retry_until steps require 'condition'",
  eval: "eval steps require 'expression'",
}

function stepTypeOk(step: FlowStep): boolean {
  switch (step.type) {
    case "command":
      return Boolean(step.command) !== Boolean(step.args && step.args.length > 0)
    case "action":
      return Boolean(step.action)
    case "agent":
      return Boolean(step.agent)
    case "loop":
      return Boolean(step.iterator && step.as)
    case "retry_until":
      return Boolean(step.condition)
    case "eval":
      return Boolean(step.expression)
    default:
      return true
  }
}

export function validateFlowSteps(steps: FlowStep[], path = ""): FlowStepError[] {
  const errors: FlowStepError[] = []
  steps.forEach((step, index) => {
    const locator = `${path}steps[${index}](${step.type})`
    if (!stepTypeOk(step)) errors.push({ step: locator, error: STEP_TYPE_ERROR[step.type] })
    if (step.body) errors.push(...validateFlowSteps(step.body, `${locator}.`))
    if (step.on_failure != null && step.on_failure !== "" && step.on_failure !== "continue") {
      errors.push({ step: locator, error: `invalid on_failure '${step.on_failure}'` })
    }
  })
  return errors
}

export function pathFromLocator(locator: string): StepPath {
  const path: StepPath = []
  for (const match of locator.matchAll(/steps\[(\d+)\]/g)) {
    path.push(Number(match[1]))
  }
  return path
}
