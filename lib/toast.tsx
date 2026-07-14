"use client"

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { uid } from "@/lib/utils"

// ─── types ───────────────────────────────────────────────────────────────────

export type ToastKind = "success" | "error"

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  detail: string | null
}

export type ToastAction =
  | { type: "add"; toast: Toast }
  | { type: "dismiss"; id: string }

export type ToastState = Toast[]

// ─── reducer (pure, exported for testing) ────────────────────────────────────

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case "add":
      return [...state, action.toast]
    case "dismiss":
      return state.filter((t) => t.id !== action.id)
    default:
      return state
  }
}

export const SUCCESS_DISMISS_MS = 3_000

export function scheduleAutoDismiss(
  id: string,
  dispatch: Dispatch<ToastAction>,
  delayMs = SUCCESS_DISMISS_MS,
): void {
  setTimeout(() => dispatch({ type: "dismiss", id }), delayMs)
}

// ─── context ─────────────────────────────────────────────────────────────────

interface ToastContextValue {
  toasts: ToastState
  dismiss: (id: string) => void
  success: (message: string, detail?: string | null) => void
  error: (message: string, detail?: string | null) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, [])

  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), [])

  const success = useCallback((message: string, detail: string | null = null) => {
    const id = uid()
    dispatch({ type: "add", toast: { id, kind: "success", message, detail } })
    scheduleAutoDismiss(id, dispatch)
  }, [])

  const error = useCallback((message: string, detail: string | null = null) => {
    const id = uid()
    dispatch({ type: "add", toast: { id, kind: "error", message, detail } })
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, dismiss, success, error }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>")
  return ctx
}

// ─── host / portal ────────────────────────────────────────────────────────────

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-w-64 max-w-sm items-start gap-3 rounded-xl border px-4 py-3 font-mono text-xs shadow-lg",
        toast.kind === "success"
          ? "border-ok/30 bg-card text-ok"
          : "border-err/30 bg-card text-err",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{toast.message}</span>
        {toast.detail && toast.detail !== toast.message && (
          <span className="mt-0.5 block text-[10px] opacity-70">{toast.detail}</span>
        )}
      </span>
      {toast.kind === "error" && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function ToastHost() {
  const { toasts, dismiss } = useToast()

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={() => dismiss(toast.id)} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
