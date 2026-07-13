import { describe, expect, it } from "vitest"
import { normalizeError } from "@/lib/error-message"

describe("normalizeError", () => {
  it("returns a connectivity message for a TypeError", () => {
    const err = new TypeError("Failed to fetch")
    const result = normalizeError(err)
    expect(result.message).toBe("Could not connect to the server")
    expect(result.detail).toBe("Failed to fetch")
  })

  it("returns a connectivity message for a network TypeError", () => {
    const err = new TypeError("NetworkError when attempting to fetch resource.")
    const result = normalizeError(err)
    expect(result.message).toBe("Could not connect to the server")
    expect(result.detail).toBe("NetworkError when attempting to fetch resource.")
  })

  it("surfaces non-network TypeError messages", () => {
    const err = new TypeError("Cannot read properties of null (reading 'id')")
    const result = normalizeError(err)
    expect(result.message).toBe("Cannot read properties of null (reading 'id')")
    expect(result.detail).toBe("Cannot read properties of null (reading 'id')")
  })

  it("surfaces a string FastAPI detail directly", () => {
    const body = { detail: "project not found" }
    const result = normalizeError(body)
    expect(result.message).toBe("project not found")
    expect(result.detail).toBe("project not found")
  })

  it("extracts msg from a FastAPI validation error array", () => {
    const body = {
      detail: [
        { loc: ["body", "name"], msg: "field required", type: "value_error.missing" },
        { loc: ["body", "repo"], msg: "invalid url", type: "value_error" },
      ],
    }
    const result = normalizeError(body)
    expect(result.message).toBe("field required")
    expect(result.detail).toBe("field required; invalid url")
  })

  it("uses error key when msg is absent in array items", () => {
    const body = { detail: [{ error: "connection refused" }] }
    const result = normalizeError(body)
    expect(result.message).toBe("connection refused")
    expect(result.detail).toBe("connection refused")
  })

  it("returns a generic message for unknown shaped errors", () => {
    const result = normalizeError(42)
    expect(result.message).toBe("An unexpected error occurred")
    expect(result.detail).toBe("42")
  })

  it("returns the error message for generic Error instances", () => {
    const err = new Error("something broke")
    const result = normalizeError(err)
    expect(result.message).toBe("something broke")
    expect(result.detail).toBe("something broke")
  })
})
