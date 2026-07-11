// Steps → grafo con layout calculado para React Flow. El orden de ejecución es
// el orden de la lista: las aristas se derivan, nunca se editan. Posiciones
// calculadas en cada render — no se persisten (flows.json es del engine).
import type { FlowStep } from "@/lib/types"
import type { StepPath } from "@/lib/flow-steps"

export const NODE_W = 260
export const NODE_H = 64
const GAP = 24
const PAD = 16
const HEADER = 36

export interface FlowGraphNode {
  id: string
  path: StepPath
  step: FlowStep
  parentId?: string
  position: { x: number; y: number }
  width: number
  height: number
  container: boolean
}

export interface FlowGraphEdge {
  id: string
  source: string
  target: string
}

export function nodeId(path: StepPath): string {
  return `s${path.join("-")}`
}

export function stepSummary(step: FlowStep): string {
  switch (step.type) {
    case "command":
      return step.command ?? (step.args ?? []).join(" ")
    case "agent":
      return step.agent ?? ""
    case "action":
      return step.action ?? ""
    case "loop":
      return `${step.iterator ?? "?"} as ${step.as ?? "?"}`
    case "retry_until":
      return step.condition ?? ""
    case "eval":
      return step.expression ?? ""
    default:
      return ""
  }
}

function isContainer(step: FlowStep): boolean {
  return step.type === "loop" || step.type === "retry_until"
}

interface Placed {
  nodes: FlowGraphNode[]
  width: number
  height: number
}

function placeStep(step: FlowStep, path: StepPath, parentId?: string): Placed {
  if (!isContainer(step)) {
    return {
      nodes: [{ id: nodeId(path), path, step, parentId, position: { x: 0, y: 0 }, width: NODE_W, height: NODE_H, container: false }],
      width: NODE_W,
      height: NODE_H,
    }
  }

  const id = nodeId(path)
  const children: FlowGraphNode[] = []
  let y = HEADER + PAD
  let innerWidth = NODE_W
  const body = step.body ?? []
  for (const [i, child] of body.entries()) {
    const placed = placeStep(child, [...path, i], id)
    // el primer nodo de placed es el hijo directo: posicionarlo relativo al padre
    placed.nodes[0] = { ...placed.nodes[0], position: { x: PAD, y } }
    children.push(...placed.nodes)
    y += placed.height + GAP
    innerWidth = Math.max(innerWidth, placed.width)
  }
  const contentHeight = body.length > 0 ? y - GAP : HEADER + PAD + NODE_H
  const height = contentHeight + PAD
  const width = innerWidth + PAD * 2

  const container: FlowGraphNode = {
    id,
    path,
    step,
    parentId,
    position: { x: 0, y: 0 },
    width,
    height,
    container: true,
  }
  return { nodes: [container, ...children], width, height }
}

export function buildFlowGraph(steps: FlowStep[]): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] } {
  const nodes: FlowGraphNode[] = []
  const edges: FlowGraphEdge[] = []
  let y = 0
  steps.forEach((step, i) => {
    const placed = placeStep(step, [i])
    placed.nodes[0] = { ...placed.nodes[0], position: { x: 0, y } }
    nodes.push(...placed.nodes)
    y += placed.height + GAP
  })

  // Aristas secuenciales por nivel: recorremos los nodos agrupando por parentId.
  const byParent = new Map<string | undefined, FlowGraphNode[]>()
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }
  for (const siblings of byParent.values()) {
    const ordered = [...siblings].sort((a, b) => a.path[a.path.length - 1] - b.path[b.path.length - 1])
    for (let i = 0; i + 1 < ordered.length; i++) {
      edges.push({ id: `${ordered[i].id}->${ordered[i + 1].id}`, source: ordered[i].id, target: ordered[i + 1].id })
    }
  }
  return { nodes, edges }
}
