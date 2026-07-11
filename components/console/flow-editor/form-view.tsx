"use client"

import { ListPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FlowStep } from "@/lib/types"
import { emptyStep, removeStepAt, updateStepAt } from "@/lib/flow-steps"
import { StepFields } from "./step-fields"

export function FormView({ steps, onChange }: { steps: FlowStep[]; onChange: (steps: FlowStep[]) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
        <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => onChange([...steps, emptyStep()])}>
          <ListPlus />Step
        </Button>
      </div>
      <div className="space-y-3">
        {steps.map((step, index) => (
          <div key={index} className="rounded-lg border border-border bg-background p-4">
            <div className="mb-3 font-mono text-[11px] text-muted-foreground">step {index + 1} of {steps.length}</div>
            <StepFields step={step} onChange={(patch) => onChange(updateStepAt(steps, [index], patch))} />
            {(step.type === "loop" || step.type === "retry_until") && step.body && step.body.length > 0 && (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {step.body.length} nested step{step.body.length === 1 ? "" : "s"} — edit the body from the Graph tab.
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <Button size="icon-xs" variant="ghost" title="Remove step" onClick={() => onChange(removeStepAt(steps, [index]))}><X /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
