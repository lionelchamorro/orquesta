/**
 * Shared helper for submitting a feature to the project's features.md queue.
 *
 * Extracted as a plain async function so it is independently testable without
 * a React testing environment. The FactoryQueue component calls this function
 * and uses its return value to display success/error feedback.
 */
import { normalizeError } from "@/lib/error-message"

export interface AddFeatureResult {
  /** null on success; human-readable error message on failure. */
  error: string | null
  /** Absolute path to the features file that was written (on success). */
  featuresPath?: string
}

/**
 * POST /api/control-plane/projects/{projectId}/features with {title, description}.
 *
 * Returns `{ error: null, featuresPath: "..." }` on success, or
 * `{ error: "<message>" }` on failure — never throws.
 */
export async function submitAddFeature(
  projectId: string,
  title: string,
  description: string,
): Promise<AddFeatureResult> {
  try {
    const res = await fetch(`/api/control-plane/projects/${projectId}/features`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    })
    if (res.ok) {
      const body = (await res.json()) as { features_path?: string }
      return { error: null, featuresPath: body.features_path }
    }
    const body = await res.json().catch(() => null)
    const { message } = normalizeError(body ?? new Error(`HTTP ${res.status}`))
    return { error: message }
  } catch (err) {
    const { message } = normalizeError(err)
    return { error: message }
  }
}
