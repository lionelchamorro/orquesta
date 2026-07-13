import { afterEach, describe, expect, it, vi } from "vitest"
import { stopQueuedRun } from "../project-view"

describe("stopQueuedRun", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns null when the stop request succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)

    await expect(stopQueuedRun("run-1")).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith("/api/control-plane/runs/run-1/stop", {
      method: "POST",
    })
  })

  it("returns a normalized error when the stop request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "run not found" }),
      }),
    )

    await expect(stopQueuedRun("run-1")).resolves.toBe("cancel failed: run not found")
  })
})
