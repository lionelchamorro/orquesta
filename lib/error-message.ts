export interface NormalizedError {
  message: string
  detail: string | null
}

export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof TypeError) {
    return { message: "Could not connect to the server", detail: err.message }
  }

  if (err !== null && typeof err === "object" && "detail" in err) {
    const raw = (err as { detail: unknown }).detail
    if (typeof raw === "string") {
      return { message: raw, detail: raw }
    }
    if (Array.isArray(raw)) {
      const parts = raw.map((d: unknown) => {
        if (d !== null && typeof d === "object") {
          const item = d as Record<string, unknown>
          return typeof item.msg === "string"
            ? item.msg
            : typeof item.error === "string"
              ? item.error
              : JSON.stringify(d)
        }
        return String(d)
      })
      return { message: parts[0] ?? "Request failed", detail: parts.join("; ") }
    }
  }

  if (err instanceof Error) {
    return { message: err.message, detail: err.message }
  }

  return { message: "An unexpected error occurred", detail: String(err) }
}
