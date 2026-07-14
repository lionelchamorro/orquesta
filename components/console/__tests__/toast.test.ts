import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SUCCESS_DISMISS_MS,
  scheduleAutoDismiss,
  toastReducer,
  type Toast,
  type ToastState,
} from "@/lib/toast"

const ok: Toast = { id: "t1", kind: "success", message: "Saved", detail: null }
const err: Toast = { id: "t2", kind: "error", message: "Failed", detail: "connection refused" }

describe("toastReducer", () => {
  it("add action appends a toast", () => {
    const next = toastReducer([], { type: "add", toast: ok })
    expect(next).toEqual([ok])
  })

  it("dismiss removes by id", () => {
    const state: ToastState = [ok, err]
    const next = toastReducer(state, { type: "dismiss", id: "t1" })
    expect(next).toEqual([err])
  })

  it("dismiss is a no-op for an unknown id", () => {
    const state: ToastState = [ok]
    const next = toastReducer(state, { type: "dismiss", id: "nope" })
    expect(next).toEqual([ok])
  })

  it("add preserves existing toasts", () => {
    const state: ToastState = [ok]
    const next = toastReducer(state, { type: "add", toast: err })
    expect(next).toEqual([ok, err])
  })

  it("multiple independent toasts can coexist", () => {
    let state: ToastState = []
    const t1: Toast = { id: "a", kind: "success", message: "A", detail: null }
    const t2: Toast = { id: "b", kind: "error", message: "B", detail: null }
    state = toastReducer(state, { type: "add", toast: t1 })
    state = toastReducer(state, { type: "add", toast: t2 })
    expect(state).toHaveLength(2)
    state = toastReducer(state, { type: "dismiss", id: "a" })
    expect(state).toEqual([t2])
  })
})

describe("scheduleAutoDismiss", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("dispatches dismiss after the delay", () => {
    const dispatch = vi.fn()
    scheduleAutoDismiss("t1", dispatch)
    expect(dispatch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SUCCESS_DISMISS_MS)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "dismiss", id: "t1" })
  })

  it("uses a custom delay when provided", () => {
    const dispatch = vi.fn()
    scheduleAutoDismiss("t2", dispatch, 500)
    vi.advanceTimersByTime(499)
    expect(dispatch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(dispatch).toHaveBeenCalled()
  })

  it("does not dismiss a different id", () => {
    const dispatch = vi.fn()
    scheduleAutoDismiss("t1", dispatch)
    vi.advanceTimersByTime(SUCCESS_DISMISS_MS)
    expect(dispatch).toHaveBeenCalledWith({ type: "dismiss", id: "t1" })
    const call = dispatch.mock.calls[0][0] as { id: string }
    expect(call.id).toBe("t1")
  })
})
