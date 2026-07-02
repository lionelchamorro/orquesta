import { describe, expect, it } from "vitest"
import { deskStatus } from "../status"
import type { RunEvent } from "@/lib/types"

function event(partial: Partial<RunEvent> & Pick<RunEvent, "event">): RunEvent {
  return { ts: "2026-07-02T00:00:00Z", ...partial } as RunEvent
}

describe("deskStatus", () => {
  it("marks every role idle when the run is not active, even the hub", () => {
    const events = [event({ event: "run_started" }), event({ event: "agent_run", role: "coder" })]
    expect(deskStatus("coder", events, false)).toBe("idle")
    expect(deskStatus("orchestrator", events, false)).toBe("idle")
  })

  it("always reports the hub as coord while a run is active", () => {
    const events = [event({ event: "run_started" })]
    expect(deskStatus("orchestrator", events, true)).toBe("coord")
  })

  it("derives done/working/failed/idle from a coder-ok, tester-fail sequence", () => {
    const events = [
      event({ event: "run_started" }),
      event({ event: "agent_run", role: "coder", status: "tests_pass" }),
      event({ event: "agent_run", role: "tester", status: "tests_fail" }),
    ]
    expect(deskStatus("coder", events, true)).toBe("done")
    expect(deskStatus("tester", events, true)).toBe("failed")
    expect(deskStatus("critic", events, true)).toBe("idle") // blocked: tester failed
    expect(deskStatus("planner", events, true)).toBe("done") // earlier in the pipeline, no own event
  })

  it("marks the role right after a successful active role as waiting", () => {
    const events = [
      event({ event: "run_started" }),
      event({ event: "agent_run", role: "coder", status: "tests_pass" }),
    ]
    expect(deskStatus("coder", events, true)).toBe("working")
    expect(deskStatus("tester", events, true)).toBe("waiting")
    expect(deskStatus("critic", events, true)).toBe("idle")
  })

  it("scopes to events after the most recent run_started, ignoring a prior run", () => {
    const events = [
      event({ event: "run_started" }),
      event({ event: "agent_run", role: "tester", status: "tests_fail" }),
      event({ event: "run_started" }),
      event({ event: "agent_run", role: "coder", status: "tests_pass" }),
    ]
    expect(deskStatus("tester", events, true)).toBe("waiting")
    expect(deskStatus("coder", events, true)).toBe("working")
  })

  it("derives status for a custom role from its own agent_run history only", () => {
    const events = [
      event({ event: "run_started" }),
      event({ event: "agent_run", role: "architect", status: "approved" }),
    ]
    expect(deskStatus("architect", events, true)).toBe("working")

    const events2 = [
      ...events,
      event({ event: "agent_run", role: "qa", status: "rejected" }),
    ]
    expect(deskStatus("architect", events2, true)).toBe("done")
    expect(deskStatus("qa", events2, true)).toBe("failed")
  })

  it("returns idle for a role with no activity at all in the current run", () => {
    const events = [event({ event: "run_started" })]
    expect(deskStatus("coder", events, true)).toBe("idle")
  })
})
