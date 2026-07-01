import { StatusBadge } from "@/components/status-badge"
import type { Task } from "@/lib/types"

export function TasksTable({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center font-mono text-sm text-muted-foreground">
        No tasks yet — run <span className="text-foreground">orq-lite plan</span> or{" "}
        <span className="text-foreground">orq-lite factory</span>.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-card/50 text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">ID</th>
            <th className="px-4 py-3 font-medium">Work</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Verify</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Att</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Agent</th>
            <th className="px-4 py-3 font-medium">Title</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-border last:border-0 hover:bg-card/40">
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.id}</td>
              <td className="px-4 py-3">
                <StatusBadge status={t.status} />
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <StatusBadge status={t.verify_state} />
              </td>
              <td className="hidden px-4 py-3 font-mono text-xs md:table-cell">{t.attempts}</td>
              <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground md:table-cell">
                {t.last_agent || "—"}
              </td>
              <td className="px-4 py-3 text-sm">
                {t.title}
                {t.failure_reason && (
                  <span className="ml-1 text-muted-foreground">({t.failure_reason})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
