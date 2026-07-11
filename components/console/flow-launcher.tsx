"use client"

import { useMemo, useState } from "react"
import { Play, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { normalizeError } from "@/lib/error-message"
import { useToast } from "@/lib/toast"
import { useFlowCatalog } from "@/lib/use-flow-catalog"
import type { Run } from "@/lib/types"

function preflightProblems(preflight: Record<string, string>): string[] {
  return Object.entries(preflight)
    .filter(([, status]) => status !== "ok")
    .map(([role, status]) => `${role}: ${status.replace(/_/g, " ")}`)
}

export function FlowLauncher({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const toast = useToast()
  const { flows, fallbackFlows, unavailable, doctor } = useFlowCatalog(projectId)
  const [flowName, setFlowName] = useState("")
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [launching, setLaunching] = useState(false)

  const flowNames = flows ? flows.map((f) => f.name) : [...fallbackFlows]

  // initialise selection when catalog loads
  const effectiveFlowName = flowName || (flowNames[0] ?? "")

  const selectedFlow = useMemo(
    () => flows?.find((f) => f.name === effectiveFlowName),
    [flows, effectiveFlowName],
  )

  const inputs = useMemo(() => {
    const defaults: Record<string, string> = {}
    for (const [name, spec] of Object.entries(selectedFlow?.inputs ?? {})) {
      if (spec.default !== null && spec.default !== undefined) defaults[name] = String(spec.default)
    }
    return { ...defaults, ...(edits[effectiveFlowName] ?? {}) }
  }, [selectedFlow, edits, effectiveFlowName])

  const missingRequired = selectedFlow
    ? Object.entries(selectedFlow.inputs)
        .filter(([name, spec]) => spec.required && !inputs[name]?.trim())
        .map(([name]) => name)
    : []
  const problems = selectedFlow ? preflightProblems(selectedFlow.preflight) : []
  const doctorBlocked = doctor !== null && !doctor.ok
  const blocked = disabled || launching || doctorBlocked || missingRequired.length > 0

  async function launch() {
    setLaunching(true)
    try {
      const body =
        unavailable && effectiveFlowName === "factory"
          ? { kind: "factory" }
          : { kind: "flow", flow: effectiveFlowName, inputs }
      const res = await fetch(`/api/control-plane/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        toast.error("run already active")
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const { message, detail } = normalizeError(body ?? new Error(`HTTP ${res.status}`))
        toast.error(message, detail)
        return
      }
      const run = (await res.json()) as Run
      toast.success(run.state === "queued" ? "queued behind active run" : "launched")
    } catch (err) {
      const { message, detail } = normalizeError(err)
      toast.error(message, detail)
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={effectiveFlowName}
        onChange={(e) => setFlowName(e.target.value)}
        disabled={disabled || launching || (flows === null && !unavailable)}
        className="rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50 disabled:opacity-50"
      >
        {flowNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {selectedFlow &&
        Object.entries(selectedFlow.inputs).map(([name, spec]) => (
          <input
            key={name}
            value={inputs[name] ?? ""}
            onChange={(e) =>
              setEdits((prev) => ({
                ...prev,
                [effectiveFlowName]: { ...prev[effectiveFlowName], [name]: e.target.value },
              }))
            }
            placeholder={`${name}${spec.required ? " *" : ""}`}
            title={`${name} (${spec.type})${spec.required ? " — required" : ""}`}
            disabled={disabled || launching}
            className={cn(
              "w-32 rounded-lg border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary/50 disabled:opacity-50",
              spec.required && !inputs[name]?.trim() ? "border-warn/60" : "border-border",
            )}
          />
        ))}

      <Button size="sm" className="font-mono text-xs" disabled={blocked} onClick={launch}>
        <Play className="h-3.5 w-3.5" />
        {launching ? "launching…" : "Run"}
      </Button>

      {doctorBlocked && (
        <span
          className="inline-flex items-center gap-1 font-mono text-[11px] text-err"
          title={doctor?.checks
            .filter((c) => c.status === "error")
            .map((c) => `${c.name}: ${c.detail}`)
            .join("\n")}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          doctor: preflight failed
        </span>
      )}
      {!doctorBlocked && problems.length > 0 && (
        <span className="font-mono text-[11px] text-warn" title={problems.join("\n")}>
          preflight: {problems.length} warning{problems.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  )
}
