"use client"

import type { FlowStep, FlowStepType } from "@/lib/types"

const stepTypes: FlowStepType[] = ["command", "agent", "action", "loop", "retry_until", "eval"]

const field = "rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
const label = "font-mono text-[11px] uppercase tracking-wide text-muted-foreground"

export function StepFields({ step, onChange }: { step: FlowStep; onChange: (patch: Partial<FlowStep>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={label}>Type</span>
          <select value={step.type} onChange={(e) => onChange({ type: e.target.value as FlowStepType })} className={field}>
            {stepTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>On failure</span>
          <select value={step.on_failure ?? ""} onChange={(e) => onChange({ on_failure: e.target.value as "" | "continue" })} className={field}>
            <option value="">stop</option>
            <option value="continue">continue</option>
          </select>
        </label>
      </div>

      {step.type === "command" && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Command (shell string)</span>
            <input value={step.command ?? ""} onChange={(e) => { const v = e.target.value; onChange({ command: v || undefined, args: v ? undefined : step.args }) }} placeholder="go test ./..." className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Args (argv, alternative to command)</span>
            <input value={(step.args ?? []).join(" ")} onChange={(e) => { const args = e.target.value.split(" ").filter(Boolean); onChange({ args: args.length > 0 ? args : undefined, command: args.length > 0 ? undefined : step.command }) }} placeholder="git push -u origin branch" className={field} />
          </label>
          <p className="col-span-full font-mono text-[11px] text-muted-foreground">The engine requires exactly one of command / args — filling one clears the other.</p>
        </div>
      )}

      {step.type === "agent" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Agent role</span>
          <input value={step.agent ?? ""} onChange={(e) => onChange({ agent: e.target.value })} placeholder="coder" className={field} />
        </label>
      )}

      {step.type === "action" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Action</span>
          <input value={step.action ?? ""} onChange={(e) => onChange({ action: e.target.value })} placeholder="factory_extract_features" className={field} />
        </label>
      )}

      {step.type === "loop" && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Iterator</span>
            <input value={step.iterator ?? ""} onChange={(e) => onChange({ iterator: e.target.value })} placeholder="{features_queue}" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>As</span>
            <input value={step.as ?? ""} onChange={(e) => onChange({ as: e.target.value })} placeholder="feature" className={field} />
          </label>
        </div>
      )}

      {step.type === "retry_until" && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
          <label className="flex flex-col gap-1">
            <span className={label}>Condition</span>
            <input value={step.condition ?? ""} onChange={(e) => onChange({ condition: e.target.value })} placeholder="{task_verified} == true" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Max retries</span>
            <input type="number" value={step.max_retries ?? 1} onChange={(e) => onChange({ max_retries: Number(e.target.value) })} className={field} />
          </label>
        </div>
      )}

      {step.type === "eval" && (
        <label className="flex flex-col gap-1">
          <span className={label}>Expression</span>
          <input value={step.expression ?? ""} onChange={(e) => onChange({ expression: e.target.value })} placeholder="{lint_res.pass} && {tester_res.pass}" className={field} />
        </label>
      )}
    </div>
  )
}
