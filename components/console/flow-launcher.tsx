"use client"

import { useEffect, useMemo, useState } from "react"
import { Play, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DoctorReport, FlowCatalog, FlowCatalogEntry } from "@/lib/types"

// Fallback when the project's serve predates GET /api/flows (I1): the static
// selector this launcher replaces (Task 4 behavior).
const FALLBACK_OPTIONS = ["factory", "factory_fast_governed", "pr_review", "issue_fix"] as const

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

function preflightProblems(flow: FlowCatalogEntry): string[] {
  return Object.entries(flow.preflight)
    .filter(([, status]) => status !== "ok")
    .map(([role, status]) => `${role}: ${status.replace(/_/g, " ")}`)
}

export function FlowLauncher({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [catalog, setCatalog] = useState<FlowCatalogEntry[] | null | "unavailable">(null)
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [flowName, setFlowName] = useState("")
  // User-typed overrides keyed by flow name; effective inputs are derived by
  // merging over the flow's declared defaults at render (no reset effect).
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    fetchJSON<FlowCatalog>(`/api/control-plane/projects/${projectId}/flow-catalog`).then((data) => {
      if (cancelled) return
      if (data === null || data.flows.length === 0) {
        setCatalog("unavailable")
        setFlowName(FALLBACK_OPTIONS[0])
      } else {
        setCatalog(data.flows)
        setFlowName(data.flows[0].name)
      }
    })
    fetchJSON<DoctorReport>(`/api/control-plane/projects/${projectId}/doctor`).then((data) => {
      if (!cancelled) setDoctor(data) // null = endpoint unavailable -> no gating
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const selectedFlow = useMemo(
    () => (Array.isArray(catalog) ? catalog.find((f) => f.name === flowName) : undefined),
    [catalog, flowName],
  )

  const inputs = useMemo(() => {
    const defaults: Record<string, string> = {}
    for (const [name, spec] of Object.entries(selectedFlow?.inputs ?? {})) {
      if (spec.default !== null && spec.default !== undefined) defaults[name] = String(spec.default)
    }
    return { ...defaults, ...(edits[flowName] ?? {}) }
  }, [selectedFlow, edits, flowName])

  const missingRequired = selectedFlow
    ? Object.entries(selectedFlow.inputs)
        .filter(([name, spec]) => spec.required && !inputs[name]?.trim())
        .map(([name]) => name)
    : []
  const problems = selectedFlow ? preflightProblems(selectedFlow) : []
  const doctorBlocked = doctor !== null && !doctor.ok
  const blocked = disabled || launching || doctorBlocked || missingRequired.length > 0

  async function launch() {
    setLaunching(true)
    setMessage("")
    try {
      const body =
        catalog === "unavailable" && flowName === "factory"
          ? { kind: "factory" }
          : { kind: "flow", flow: flowName, inputs }
      const res = await fetch(`/api/control-plane/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        setMessage("run already active")
        return
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        setMessage(`launch failed: ${detail?.detail ?? `HTTP ${res.status}`}`)
        return
      }
      setMessage("launched")
    } catch (err) {
      setMessage(`launch failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLaunching(false)
    }
  }

  const flowNames = Array.isArray(catalog) ? catalog.map((f) => f.name) : [...FALLBACK_OPTIONS]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={flowName}
        onChange={(e) => setFlowName(e.target.value)}
        disabled={disabled || launching || catalog === null}
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
                [flowName]: { ...prev[flowName], [name]: e.target.value },
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
      {message && (
        <span
          className={cn(
            "font-mono text-[11px]",
            message.startsWith("launch failed") ? "text-err" : "text-muted-foreground",
          )}
        >
          {message}
        </span>
      )}
    </div>
  )
}
