"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, CornerDownRight, ListPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FlowStep } from "@/lib/types"
import { appendToBody, emptyStep, removeStepAt, updateStepAt, type StepPath } from "@/lib/flow-steps"
import { StepFields } from "./step-fields"

// ---------------------------------------------------------------------------
// StepRow — renders one step at any depth level. Container steps (loop /
// retry_until) show a collapsible body section that recurses via StepListEditor.
// ---------------------------------------------------------------------------

function StepRow({
  step,
  path,
  rootSteps,
  onRootChange,
}: {
  step: FlowStep
  path: StepPath
  rootSteps: FlowStep[]
  onRootChange: (next: FlowStep[]) => void
}) {
  const [bodyOpen, setBodyOpen] = useState(true)
  const isContainer = step.type === "loop" || step.type === "retry_until"
  const bodyCount = step.body?.length ?? 0

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">
          step {path.map((i) => i + 1).join(".")}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Remove step"
          onClick={() => onRootChange(removeStepAt(rootSteps, path))}
        >
          <X />
        </Button>
      </div>

      <StepFields
        step={step}
        onChange={(patch) => onRootChange(updateStepAt(rootSteps, path, patch))}
      />

      {isContainer && (
        <div className="mt-4">
          <button
            type="button"
            className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setBodyOpen((v) => !v)}
          >
            {bodyOpen
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
            Body ({bodyCount} step{bodyCount === 1 ? "" : "s"})
          </button>

          {bodyOpen && (
            <div className="mt-2">
              <StepListEditor
                steps={step.body ?? []}
                pathPrefix={path}
                rootSteps={rootSteps}
                onRootChange={onRootChange}
                depth={1}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-3 font-mono text-xs"
                onClick={() => onRootChange(appendToBody(rootSteps, path, emptyStep()))}
              >
                <CornerDownRight />Add nested step
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StepListEditor — renders an ordered list of steps at any depth. Passes
// rootSteps + onRootChange straight through so every handler operates on the
// full tree with a complete StepPath rather than a relative one.
// ---------------------------------------------------------------------------

function StepListEditor({
  steps,
  pathPrefix,
  rootSteps,
  onRootChange,
  depth,
}: {
  steps: FlowStep[]
  pathPrefix: StepPath
  rootSteps: FlowStep[]
  onRootChange: (next: FlowStep[]) => void
  depth: number
}) {
  return (
    <div className={cn("space-y-3", depth > 0 && "ml-4 border-l border-border/50 pl-4")}>
      {steps.map((step, index) => (
        <StepRow
          key={index}
          step={step}
          path={[...pathPrefix, index]}
          rootSteps={rootSteps}
          onRootChange={onRootChange}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FormView — public entry point. Passes itself as both rootSteps and the
// top-level onRootChange so deeply nested callbacks always reach the root.
// ---------------------------------------------------------------------------

export function FormView({ steps, onChange }: { steps: FlowStep[]; onChange: (steps: FlowStep[]) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
        <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => onChange([...steps, emptyStep()])}>
          <ListPlus />Step
        </Button>
      </div>
      <StepListEditor
        steps={steps}
        pathPrefix={[]}
        rootSteps={steps}
        onRootChange={onChange}
        depth={0}
      />
    </div>
  )
}
