// Operaciones inmutables sobre el árbol de steps de un flow. Un StepPath es la
// lista de índices por nivel: [1, 0] = steps[1].body[0].
import type { FlowStep } from "@/lib/types"

export type StepPath = number[]

export function emptyStep(): FlowStep {
  // Placeholder válido para que un draft nuevo guarde; el engine rechaza un
  // command vacío ("command steps require exactly one of command/args").
  return { type: "command", command: "echo configure this step" }
}

export function getStepAt(steps: FlowStep[], path: StepPath): FlowStep | undefined {
  const [head, ...rest] = path
  const step = steps[head]
  if (!step || rest.length === 0) return step
  return step.body ? getStepAt(step.body, rest) : undefined
}

function withSiblings(steps: FlowStep[], path: StepPath, edit: (siblings: FlowStep[], index: number) => FlowStep[]): FlowStep[] {
  const [head, ...rest] = path
  if (rest.length === 0) return edit(steps, head)
  const parent = steps[head]
  if (!parent?.body) return steps
  return steps.map((s, i) => (i === head ? { ...parent, body: withSiblings(parent.body!, rest, edit) } : s))
}

export function updateStepAt(steps: FlowStep[], path: StepPath, patch: Partial<FlowStep>): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) =>
    siblings.map((s, j) => (j === i ? { ...s, ...patch } : s)),
  )
}

export function insertStepAt(steps: FlowStep[], path: StepPath, step: FlowStep): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) => [...siblings.slice(0, i), step, ...siblings.slice(i)])
}

export function removeStepAt(steps: FlowStep[], path: StepPath): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) => siblings.filter((_, j) => j !== i))
}

export function moveStep(steps: FlowStep[], path: StepPath, dir: -1 | 1): FlowStep[] {
  return withSiblings(steps, path, (siblings, i) => {
    const j = i + dir
    if (j < 0 || j >= siblings.length) return siblings
    const out = [...siblings]
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  })
}

export function appendToBody(steps: FlowStep[], path: StepPath, step: FlowStep): FlowStep[] {
  const target = getStepAt(steps, path)
  if (!target || (target.type !== "loop" && target.type !== "retry_until")) return steps
  return updateStepAt(steps, path, { body: [...(target.body ?? []), step] })
}
