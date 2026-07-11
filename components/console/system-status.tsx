"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSystemStatus } from "@/lib/use-system-status"

const SERVICES = [
  { key: "api", label: "control plane" },
  { key: "opencode", label: "opencode" },
  { key: "mcp", label: "mcp" },
] as const

export function SystemStatusStrip() {
  const { status } = useSystemStatus()
  return (
    <div className="border-t border-border px-5 py-3">
      <div className="flex items-center gap-3">
        {SERVICES.map((s) => {
          const state = status?.[s.key]
          return (
            <span key={s.key} title={`${s.label}: ${state ?? "checking"}`} className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  state === "up" && "bg-emerald-500",
                  state === "down" && "bg-red-500",
                  !state && "bg-muted-foreground/40",
                )}
              />
              {s.label}
            </span>
          )
        })}
      </div>
      {typeof status?.activeRuns === "number" && (
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{status.activeRuns} active run{status.activeRuns === 1 ? "" : "s"}</p>
      )}
    </div>
  )
}

export function BackendBanner({ label, hint, onRetry }: { label: string; hint: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" className="shrink-0 font-mono text-xs" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  )
}
