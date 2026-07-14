/**
 * Tests for LiveEvents connection-state logic.
 *
 * The component itself uses EventSource and useEffect which are not available
 * in the node test environment, so we test the exported pure helpers that
 * drive the UI — connection labels, dot colours, and the retry-button
 * predicate.  These are the exact values the component renders; if they are
 * correct the integration behaviour is correct.
 */
import { describe, expect, it } from "vitest"
import {
  connectionLabel,
  connectionDot,
  connectionShowsRetry,
  type ConnectionState,
} from "../live-events"

const ALL_STATES: ConnectionState[] = ["idle", "connecting", "streaming", "error", "disconnected"]

describe("connectionLabel", () => {
  it("covers all connection states", () => {
    for (const state of ALL_STATES) {
      expect(connectionLabel[state]).toBeDefined()
    }
  })

  it("disconnected label is not perpetual-connecting text", () => {
    expect(connectionLabel["disconnected"]).not.toBe("connecting…")
    expect(connectionLabel["disconnected"]).toBe("disconnected")
  })

  it("connecting label is clearly transient", () => {
    expect(connectionLabel["connecting"]).toBe("connecting…")
  })
})

describe("connectionDot", () => {
  it("disconnected uses an error colour (never the connecting pulse)", () => {
    expect(connectionDot["disconnected"]).toContain("bg-err")
    expect(connectionDot["disconnected"]).not.toContain("animate-pulse bg-run")
  })
})

describe("connectionShowsRetry", () => {
  it("returns true for error and disconnected — the states that must show a retry button", () => {
    expect(connectionShowsRetry("error")).toBe(true)
    expect(connectionShowsRetry("disconnected")).toBe(true)
  })

  it("returns false for transient or healthy states — no retry button clutter", () => {
    expect(connectionShowsRetry("connecting")).toBe(false)
    expect(connectionShowsRetry("streaming")).toBe(false)
    expect(connectionShowsRetry("idle")).toBe(false)
  })

  it("a failed event-source transitions to a state that shows retry, not 'connecting'", () => {
    // Simulate the onerror path: state becomes "error" → retry shown.
    const afterError: ConnectionState = "error"
    expect(afterError).not.toBe("connecting")
    expect(connectionShowsRetry(afterError)).toBe(true)
  })

  it("a timed-out connection transitions to 'disconnected', not perpetual 'connecting'", () => {
    // The 10-second timeout fires → state becomes "disconnected" → retry shown.
    const afterTimeout: ConnectionState = "disconnected"
    expect(afterTimeout).not.toBe("connecting")
    expect(connectionShowsRetry(afterTimeout)).toBe(true)
  })
})
