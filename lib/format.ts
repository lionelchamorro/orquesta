export function fmtDuration(seconds?: number | null): string {
  if (seconds == null) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/**
 * Return a compact relative timestamp from an ISO-8601 string.
 * Examples: "just now", "3m ago", "2h ago", "4d ago", "2025-07-04".
 */
export function fmtRelative(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  if (isNaN(then)) return iso
  const diffMs = now - then
  const diffS = Math.floor(diffMs / 1000)
  if (diffS < 60) return "just now"
  const diffM = Math.floor(diffS / 60)
  if (diffM < 60) return `${diffM}m ago`
  const diffH = Math.floor(diffM / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 14) return `${diffD}d ago`
  // Fall back to locale date string for older items
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * Extract the flow name from an orq-lite run command string.
 * "flow:factory_fast" → "factory_fast", "flow" → "flow", "run" → "run".
 */
export function fmtRunLabel(command: string): string {
  if (command.startsWith("flow:")) return command.slice("flow:".length)
  return command
}
