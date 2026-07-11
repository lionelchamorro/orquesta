"use client"

import { useEffect, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { Check, Copy, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FlowDefinition } from "@/lib/types"
import { flowToEngineJson, parseFlowJson } from "@/lib/flow-json"

export function JsonView({
  flow,
  onApply,
}: {
  flow: FlowDefinition
  onApply: (patch: Pick<FlowDefinition, "description" | "inputs" | "steps">) => void
}) {
  const canonical = flowToEngineJson(flow)
  const [text, setText] = useState(canonical)
  const [errors, setErrors] = useState<string[]>([])
  const [applied, setApplied] = useState(false)

  // When the flow changes from outside (another tab, another flow selected),
  // re-sync the editor ONLY if the user doesn't have pending edits.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText((prev) => (prev === canonical || errors.length === 0 ? canonical : prev))
    setApplied(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical])

  const dirty = text !== canonical

  function apply() {
    const parsed = parseFlowJson(text, flow.id)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      setApplied(false)
      return
    }
    setErrors([])
    setApplied(true)
    onApply(parsed.patch)
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          {"{description, inputs, steps}"} — the exact shape orq-lite parses
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={() => navigator.clipboard?.writeText(text)}>
            <Copy />Copy
          </Button>
          <Button size="sm" variant="outline" className="font-mono text-xs" disabled={!dirty} onClick={() => { setText(canonical); setErrors([]) }}>
            <RotateCcw />Discard
          </Button>
          <Button size="sm" className="font-mono text-xs" disabled={!dirty} onClick={apply}>
            <Check />Apply
          </Button>
        </div>
      </div>

      <CodeMirror
        value={text}
        onChange={(value) => { setText(value); setApplied(false) }}
        extensions={[json()]}
        theme="dark"
        height="420px"
        basicSetup={{ lineNumbers: true, foldGutter: true }}
      />

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-400">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {applied && errors.length === 0 && (
        <p className="font-mono text-xs text-emerald-500">Applied to the editor — use Save to write it to flows.json.</p>
      )}
    </div>
  )
}
