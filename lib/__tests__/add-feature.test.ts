import { afterEach, describe, expect, it, vi } from "vitest"
import { submitAddFeature } from "@/lib/add-feature"

describe("submitAddFeature", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns null error and featuresPath on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "My feature",
            description: "Plan text",
            features_path: "/ws/features.md",
          }),
      }),
    )

    const result = await submitAddFeature("prm", "My feature", "Plan text")

    expect(result.error).toBeNull()
    expect(result.featuresPath).toBe("/ws/features.md")
  })

  it("calls the correct endpoint with JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "T", description: "", features_path: "/p" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await submitAddFeature("atlas", "T", "")

    expect(fetchMock).toHaveBeenCalledWith("/api/control-plane/projects/atlas/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", description: "" }),
    })
  })

  it("returns a normalized error message when the API returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: "title must not be empty" }),
      }),
    )

    const result = await submitAddFeature("prm", "", "")

    expect(result.error).toBe("title must not be empty")
    expect(result.featuresPath).toBeUndefined()
  })

  it("returns a network error message when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))

    const result = await submitAddFeature("prm", "T", "")

    expect(result.error).not.toBeNull()
    expect(typeof result.error).toBe("string")
  })

  it("does not throw when json() fails on error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      }),
    )

    const result = await submitAddFeature("prm", "T", "")

    expect(result.error).not.toBeNull()
  })
})
