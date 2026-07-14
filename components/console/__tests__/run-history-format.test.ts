/**
 * Tests for run-history display helpers.
 *
 * The component UI (React rendering) is not testable under the node
 * environment, so we test the pure formatting helpers that drive the display.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { fmtRunLabel, fmtRelative } from "@/lib/format"
import type { OrqRunSummary } from "@/lib/types"

// ---------------------------------------------------------------------------
// Row primary-label: flow name + relative time
// ---------------------------------------------------------------------------

function rowPrimaryLabel(run: Pick<OrqRunSummary, "command" | "started_at">): string {
  return `${fmtRunLabel(run.command)} · ${fmtRelative(run.started_at)}`
}

describe("run list row primary label", () => {
  const NOW = new Date("2026-07-13T12:00:00Z").getTime()

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows flow name and relative time for a flow run", () => {
    const run = {
      command: "flow:factory_fast",
      started_at: new Date(NOW - 4 * 86400_000).toISOString(),
    }
    expect(rowPrimaryLabel(run)).toBe("factory_fast · 4d ago")
  })

  it("shows plain command when not a flow:", () => {
    const run = {
      command: "run",
      started_at: new Date(NOW - 2 * 3600_000).toISOString(),
    }
    expect(rowPrimaryLabel(run)).toBe("run · 2h ago")
  })

  it("uses 'just now' for very recent runs", () => {
    const run = {
      command: "flow:factory_governed",
      started_at: new Date(NOW - 5000).toISOString(),
    }
    expect(rowPrimaryLabel(run)).toBe("factory_governed · just now")
  })
})

// ---------------------------------------------------------------------------
// Error indicator: errored runs are distinguishable
// ---------------------------------------------------------------------------

function isErroredRun(run: Pick<OrqRunSummary, "status">): boolean {
  return run.status === "error" || run.status === "interrupted"
}

describe("errored run detection", () => {
  it("marks status=error as errored", () => {
    expect(isErroredRun({ status: "error" })).toBe(true)
  })

  it("marks status=interrupted as errored", () => {
    expect(isErroredRun({ status: "interrupted" })).toBe(true)
  })

  it("does not mark status=ok as errored", () => {
    expect(isErroredRun({ status: "ok" })).toBe(false)
  })

  it("does not mark status=running as errored", () => {
    expect(isErroredRun({ status: "running" })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Failed agent runs detection from agent run records
// ---------------------------------------------------------------------------

import type { AgentRunRecord } from "@/lib/types"

function failedAgentRuns(records: AgentRunRecord[]): AgentRunRecord[] {
  return records.filter((r) => r.exit_code !== 0 || r.timed_out)
}

describe("failedAgentRuns", () => {
  const base: AgentRunRecord = {
    ts: "2026-07-09T00:58:46Z",
    run_id: "r20260709T005846Z-e90d",
    role: "coder",
    agent: "claude",
    task_id: "F001",
    cycle: 1,
    attempt: 1,
    provider: "anthropic",
    model: "claude-opus-4-5",
    duration_s: 120.0,
    exit_code: 0,
    timed_out: false,
    rate_limited: false,
    input_tokens: 10000,
    output_tokens: 3000,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 1.97,
    artifacts_dir: ".orquestalite/runs/r20260709T005846Z-e90d/agents/F001/coder.c1.a1",
  }

  it("returns empty when all agents succeeded", () => {
    const records = [base, { ...base, role: "verifier" }]
    expect(failedAgentRuns(records)).toHaveLength(0)
  })

  it("returns agent records with non-zero exit code", () => {
    const failed = { ...base, exit_code: 1, role: "coder" }
    expect(failedAgentRuns([base, failed])).toEqual([failed])
  })

  it("returns timed-out records", () => {
    const timedOut = { ...base, timed_out: true }
    expect(failedAgentRuns([timedOut])).toEqual([timedOut])
  })
})
