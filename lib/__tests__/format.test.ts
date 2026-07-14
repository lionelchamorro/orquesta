import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fmtRelative, fmtRunLabel } from "@/lib/format"

describe("fmtRelative", () => {
  const NOW = new Date("2026-07-13T12:00:00Z").getTime()

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns 'just now' for seconds ago", () => {
    const iso = new Date(NOW - 30_000).toISOString()
    expect(fmtRelative(iso)).toBe("just now")
  })

  it("returns minutes for < 60m ago", () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString()
    expect(fmtRelative(iso)).toBe("5m ago")
  })

  it("returns hours for < 24h ago", () => {
    const iso = new Date(NOW - 3 * 3600_000).toISOString()
    expect(fmtRelative(iso)).toBe("3h ago")
  })

  it("returns days for < 14d ago", () => {
    const iso = new Date(NOW - 4 * 86400_000).toISOString()
    expect(fmtRelative(iso)).toBe("4d ago")
  })

  it("returns a date string for older items", () => {
    const iso = new Date(NOW - 30 * 86400_000).toISOString()
    const result = fmtRelative(iso)
    // Should be a locale date string, not an 'ago' string
    expect(result).not.toMatch(/ago/)
  })

  it("returns the raw string for invalid input", () => {
    expect(fmtRelative("not-a-date")).toBe("not-a-date")
  })
})

describe("fmtRunLabel", () => {
  it("strips the flow: prefix", () => {
    expect(fmtRunLabel("flow:factory_fast")).toBe("factory_fast")
  })

  it("leaves plain command unchanged", () => {
    expect(fmtRunLabel("run")).toBe("run")
  })

  it("strips flow: but preserves the rest", () => {
    expect(fmtRunLabel("flow:factory_governed")).toBe("factory_governed")
  })

  it("handles bare 'flow' with no colon unchanged", () => {
    expect(fmtRunLabel("flow")).toBe("flow")
  })
})
