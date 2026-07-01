import { GitBranch, ExternalLink } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import type { Feature } from "@/lib/types"

export function FactoryQueue({ features }: { features: Feature[] }) {
  if (features.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center font-mono text-sm text-muted-foreground">
        Factory queue is empty. Define a feature to enqueue work.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {features.map((f) => (
        <div key={f.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{f.id}</span>
                <StatusBadge status={f.status} />
              </div>
              <p className="mt-1.5 text-sm font-medium">{f.title}</p>
            </div>
            {f.pr_url && (
              <a
                href={f.pr_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-primary hover:underline"
              >
                PR <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {f.branch}
            </span>
            <span className="text-ok">{f.tasks_done} done</span>
            {f.tasks_failed > 0 && <span className="text-err">{f.tasks_failed} failed</span>}
            {f.cost_usd > 0 && <span className="text-warn">${f.cost_usd.toFixed(2)}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
