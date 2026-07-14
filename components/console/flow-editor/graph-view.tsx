"use client"

import { useMemo, useState } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ArrowDown, ArrowUp, CornerDownRight, ListPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FlowStep } from "@/lib/types"
import { buildFlowGraph, nodeId, stepSummary, type FlowGraphNode } from "@/lib/flow-graph"
import { breadcrumbText } from "@/lib/flow-breadcrumb"
import { appendToBody, emptyStep, getStepAt, insertStepAt, moveStep, removeStepAt, updateStepAt, type StepPath } from "@/lib/flow-steps"
import { StepFields } from "./step-fields"

const FIT_OPTS = { padding: 0.15, duration: 300 } as const

const TYPE_COLORS: Record<string, string> = {
  command: "border-sky-500/50",
  agent: "border-violet-500/50",
  action: "border-emerald-500/50",
  loop: "border-amber-500/50",
  retry_until: "border-orange-500/50",
  eval: "border-pink-500/50",
}

type StepNodeData = { graph: FlowGraphNode; selected: boolean; invalid: boolean }

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { graph, selected, invalid } = data
  return (
    <div
      className={cn(
        "h-full w-full rounded-lg border-2 bg-card px-3 py-2 text-left",
        TYPE_COLORS[graph.step.type] ?? "border-border",
        graph.container && "bg-card/40",
        selected && "ring-2 ring-primary",
        invalid && "border-red-500 ring-2 ring-red-500/50",
      )}
    >
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{graph.step.type}</p>
      {!graph.container && <p className="truncate font-mono text-xs">{stepSummary(graph.step) || "—"}</p>}
      {graph.container && <p className="truncate font-mono text-[11px] text-muted-foreground">{stepSummary(graph.step)}</p>}
    </div>
  )
}

const nodeTypes = { step: StepNode }

export function GraphView({
  steps,
  onChange,
  invalidPaths,
  flowName,
}: {
  steps: FlowStep[]
  onChange: (steps: FlowStep[]) => void
  invalidPaths: StepPath[]
  flowName?: string
}) {
  const [selectedPath, setSelectedPath] = useState<StepPath | null>(null)
  const selectedStep = selectedPath ? getStepAt(steps, selectedPath) : undefined
  const invalidIds = useMemo(() => new Set(invalidPaths.map(nodeId)), [invalidPaths])

  const { nodes, edges } = useMemo(() => {
    const graph = buildFlowGraph(steps)
    const selectedId = selectedPath ? nodeId(selectedPath) : null
    const rfNodes: Node<StepNodeData>[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: n.position,
      data: { graph: n, selected: n.id === selectedId, invalid: invalidIds.has(n.id) },
      parentId: n.parentId,
      extent: n.parentId ? ("parent" as const) : undefined,
      style: { width: n.width, height: n.height },
      draggable: false,
      connectable: false,
    }))
    const rfEdges: Edge[] = graph.edges.map((e) => ({ ...e, animated: false }))
    return { nodes: rfNodes, edges: rfEdges }
  }, [steps, selectedPath, invalidIds])

  function mutate(next: FlowStep[]) {
    onChange(next)
  }

  const isContainer = selectedStep && (selectedStep.type === "loop" || selectedStep.type === "retry_until")

  // Human-readable ancestry path, e.g. "factory › loop {tasks} as feature › agent coder"
  const breadcrumb = selectedPath ? breadcrumbText(steps, selectedPath, flowName) : null
  const indexLabel = selectedPath ? `step ${selectedPath.map((i) => i + 1).join(".")}` : null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="h-[560px] rounded-xl border border-border bg-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedPath(node.data.graph.path)}
          onPaneClick={() => setSelectedPath(null)}
          onInit={(instance) => {
            // Defer one frame so the container dimensions are measured first.
            setTimeout(() => instance.fitView(FIT_OPTS), 50)
          }}
          fitView
          fitViewOptions={FIT_OPTS}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap zoomable pannable className="rounded-lg border border-border" />
        </ReactFlow>
      </div>

      <div className="space-y-3">
        <Button size="sm" variant="outline" className="w-full font-mono text-xs" onClick={() => mutate([...steps, emptyStep()])}>
          <ListPlus />Add step at the end
        </Button>

        {selectedPath && selectedStep ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {breadcrumb && (
                  <p className="truncate font-mono text-xs font-medium" title={breadcrumb}>
                    {breadcrumb}
                  </p>
                )}
                {indexLabel && (
                  <p className="font-mono text-[10px] text-muted-foreground/70">{indexLabel}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Move up"
                  onClick={() => {
                    const idx = selectedPath[selectedPath.length - 1]
                    const next = moveStep(steps, selectedPath, -1)
                    // moveStep returns the same array reference when the move
                    // is a no-op (already at the top) — only follow selection
                    // when the swap actually happened.
                    if (next !== steps) {
                      mutate(next)
                      setSelectedPath([...selectedPath.slice(0, -1), idx - 1])
                    }
                  }}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Move down"
                  onClick={() => {
                    const idx = selectedPath[selectedPath.length - 1]
                    const next = moveStep(steps, selectedPath, 1)
                    if (next !== steps) {
                      mutate(next)
                      setSelectedPath([...selectedPath.slice(0, -1), idx + 1])
                    }
                  }}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Delete"
                  onClick={() => {
                    mutate(removeStepAt(steps, selectedPath))
                    setSelectedPath(null)
                  }}
                >
                  <X />
                </Button>
              </div>
            </div>

            <StepFields step={selectedStep} onChange={(patch) => mutate(updateStepAt(steps, selectedPath, patch))} />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-xs"
                onClick={() => {
                  const idx = selectedPath[selectedPath.length - 1]
                  mutate(insertStepAt(steps, selectedPath, emptyStep()))
                  // The step the user was editing shifted down by one.
                  setSelectedPath([...selectedPath.slice(0, -1), idx + 1])
                }}
              >
                <ListPlus />Before
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-xs"
                onClick={() => mutate(insertStepAt(steps, [...selectedPath.slice(0, -1), selectedPath[selectedPath.length - 1] + 1], emptyStep()))}
              >
                <ListPlus />After
              </Button>
              {isContainer && (
                <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => mutate(appendToBody(steps, selectedPath, emptyStep()))}>
                  <CornerDownRight />Into body
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Click a node to edit it. Loops and retry_until are containers: their nested steps live inside.
          </p>
        )}
      </div>
    </div>
  )
}
