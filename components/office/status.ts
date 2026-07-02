import type { RunEvent } from "@/lib/types"

export type DeskStatus = "working" | "done" | "failed" | "waiting" | "idle" | "coord"

const HUB_ROLE = "orchestrator"

// Real orq-lite agent_run events only fire once an invocation has finished
// (they carry duration_s/exit_code/status already resolved — verified
// against orquesta-lite/internal/web/server.go event shapes), so there is no
// direct "still executing" signal. This mirrors the gameboard's original PIPE
// heuristic (gameboard.js:347-356): the role of the most recent agent_run is
// treated as "working" (it holds the floor); roles earlier in the fixed
// pipeline are done/failed by their own last status; the role right after it
// is "waiting" only if the active role didn't fail (a failure blocks the
// pipeline from advancing).
const PIPELINE_ORDER = ["planner", "parser", "coder", "tester", "critic", "reviewer", "verifier"]

function isFailureStatus(status?: string): boolean {
  if (!status) return false
  return /fail|error|reject|timeout/i.test(status)
}

function lastRunStartIndex(events: RunEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event === "run_started" || events[i].event === "run_start") return i
  }
  return 0
}

/**
 * Derive a desk's visual status from the event log of the current run.
 * `events` should be the full per-project event buffer (any age); this
 * function scopes itself to everything since the last run_started/run_start.
 */
export function deskStatus(role: string, events: RunEvent[], runActive: boolean): DeskStatus {
  const normalizedRole = role.toLowerCase()
  if (!runActive) return "idle"
  if (normalizedRole === HUB_ROLE) return "coord"

  const current = events.slice(lastRunStartIndex(events))
  const agentRuns = current.filter((e) => e.event === "agent_run")
  if (agentRuns.length === 0) return "idle"

  const lastGlobal = agentRuns[agentRuns.length - 1]
  const activeRole = (lastGlobal.role ?? "").toLowerCase()
  const activeIndex = PIPELINE_ORDER.indexOf(activeRole)
  const activeFailed = isFailureStatus(lastGlobal.status)
  const roleIndex = PIPELINE_ORDER.indexOf(normalizedRole)

  const roleRuns = agentRuns.filter((e) => (e.role ?? "").toLowerCase() === normalizedRole)
  const lastForRole = roleRuns[roleRuns.length - 1]

  if (roleIndex === -1) {
    // Custom role outside the fixed pipeline (e.g. architect/qa from a
    // governed flow): only its own history determines its status.
    if (!lastForRole) return "idle"
    if (lastForRole === lastGlobal) return activeFailed ? "failed" : "working"
    return isFailureStatus(lastForRole.status) ? "failed" : "done"
  }

  if (roleIndex < activeIndex) {
    if (!lastForRole) return "done"
    return isFailureStatus(lastForRole.status) ? "failed" : "done"
  }
  if (roleIndex === activeIndex) {
    return activeFailed ? "failed" : "working"
  }
  if (roleIndex === activeIndex + 1 && !activeFailed) {
    return "waiting"
  }
  return "idle"
}
