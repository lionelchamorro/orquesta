import { cn } from "@/lib/utils"

const map: Record<string, string> = {
  done: "border-ok/40 text-ok",
  pass: "border-ok/40 text-ok",
  commit_ok: "border-ok/40 text-ok",
  tests_pass: "border-ok/40 text-ok",
  running: "border-run/40 text-run",
  in_progress: "border-run/40 text-run",
  failed: "border-err/40 text-err",
  needs_human: "border-err/40 text-err",
  error: "border-err/40 text-err",
  commit_rejected: "border-err/40 text-err",
  tests_fail: "border-err/40 text-err",
  pending: "border-warn/40 text-warn",
  decomposed: "border-warn/40 text-warn",
  needs_clarification: "border-warn/40 text-warn",
  commit_skipped: "border-warn/40 text-warn",
  idle: "border-border text-muted-foreground",
  paused: "border-border text-muted-foreground",
}

export function StatusBadge({
  status,
  className,
}: {
  status?: string
  className?: string
}) {
  if (!status) return null
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none",
        map[status] ?? "border-border text-muted-foreground",
        className,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  )
}

export function StateDot({ state }: { state: string }) {
  const color =
    state === "running"
      ? "bg-run"
      : state === "needs_human"
        ? "bg-err"
        : state === "idle"
          ? "bg-ok"
          : "bg-muted-foreground"
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {state === "running" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-run/60" />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", color)} />
    </span>
  )
}
