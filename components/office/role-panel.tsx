"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import type { RunEvent } from "@/lib/types"
import { roleIdentity } from "./sprites"

const TABS = ["STATE", "SUMMARY", "JSON", "CHANGES"] as const
type PanelTab = (typeof TABS)[number]

function summaryFrom(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const record = result as Record<string, unknown>
  const candidate = record.notes_for_memory ?? record.summary ?? record.summary_of_cycle
  return typeof candidate === "string" ? candidate : undefined
}

function diffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "text-ok"
  if (line.startsWith("-") && !line.startsWith("---")) return "text-err"
  if (line.startsWith("@@")) return "text-primary"
  return "text-muted-foreground"
}

export function RolePanel({
  role,
  events,
  currentTaskId,
  result,
  diff,
  onClose,
  onOpenSummary,
  onOpenJson,
  onOpenChanges,
}: {
  role: string
  events: RunEvent[]
  currentTaskId?: string
  result: unknown
  diff: string | undefined
  onClose: () => void
  onOpenSummary: () => void
  onOpenJson: () => void
  onOpenChanges: () => void
}) {
  const [tab, setTab] = useState<PanelTab>("STATE")
  const dialogRef = useRef<HTMLDivElement>(null)
  const identity = roleIdentity(role)

  useEffect(() => {
    dialogRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (tab === "SUMMARY") onOpenSummary()
    if (tab === "JSON") onOpenJson()
    if (tab === "CHANGES") onOpenChanges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const activity = useMemo(
    () =>
      events
        .filter((e) => e.event === "agent_run" && (e.role ?? "").toLowerCase() === role.toLowerCase())
        .slice(-6)
        .reverse(),
    [events, role],
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${identity.label} panel`}
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="font-mono text-sm font-semibold" style={{ color: identity.color }}>
              {identity.label}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">{identity.desc}</p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close panel">
            <X />
          </Button>
        </div>

        <div className="flex items-center gap-1 border-b border-border px-3">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-wide transition-colors",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "STATE" && (
            <div className="space-y-4">
              {currentTaskId && (
                <p className="font-mono text-xs text-muted-foreground">
                  current task <span className="text-foreground">{currentTaskId}</span>
                </p>
              )}
              {activity.length === 0 && (
                <p className="font-mono text-xs text-muted-foreground">No activity yet in this run.</p>
              )}
              <ul className="space-y-2">
                {activity.map((e, i) => (
                  <li
                    key={`${e.ts}-${i}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                  >
                    <StatusBadge status={e.status} />
                    <span className="text-muted-foreground">{e.agent}</span>
                    <span className="text-muted-foreground">{e.task_id}</span>
                    {e.duration_s != null && (
                      <span className="ml-auto text-muted-foreground">{e.duration_s}s</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "SUMMARY" && (
            <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
              {summaryFrom(result) ?? "No summary available yet."}
            </p>
          )}

          {tab === "JSON" && (
            <div className="space-y-2">
              <p className="font-mono text-[11px] text-muted-foreground">
                .orquestalite/results/{role}.json
              </p>
              <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                {result ? JSON.stringify(result, null, 2) : "null"}
              </pre>
            </div>
          )}

          {tab === "CHANGES" && (
            <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed">
              {(diff ?? "").split("\n").map((line, i) => (
                <span key={i} className={cn("block", diffLineClass(line))}>
                  {line}
                </span>
              ))}
              {!diff && <span className="text-muted-foreground">No diff available for the current task.</span>}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
