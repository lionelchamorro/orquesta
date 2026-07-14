// Pure helpers for the flow step editor's ancestry breadcrumb and dirty-state
// detection. These are intentionally free of React so they can be unit-tested
// in the node environment.
import type { FlowStep } from "@/lib/types"
import type { StepPath } from "@/lib/flow-steps"
import { getStepAt } from "@/lib/flow-steps"
import { stepSummary } from "@/lib/flow-graph"

export interface BreadcrumbSegment {
  label: string
  path: StepPath
}

/**
 * Builds the ancestry chain from the flow root to a selected step.
 *
 * @param steps    - Root-level steps of the flow.
 * @param path     - StepPath (array of indices) identifying the selected step.
 * @param flowName - Optional flow name prepended as the root segment.
 * @returns Segments from root to the selected step, inclusive.
 *
 * Example: steps[1] = loop {tasks}, steps[1].body[0] = retry_until,
 * steps[1].body[0].body[0] = agent coder  →  path [1, 0, 0] produces:
 *   [ "factory", "loop {tasks} as feature", "retry_until {verified}", "agent coder" ]
 */
export function buildBreadcrumb(
  steps: FlowStep[],
  path: StepPath,
  flowName?: string,
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = []

  if (flowName) {
    segments.push({ label: flowName, path: [] })
  }

  for (let depth = 0; depth < path.length; depth++) {
    const partialPath = path.slice(0, depth + 1)
    const step = getStepAt(steps, partialPath)
    if (!step) break
    const summary = stepSummary(step)
    const label = summary ? `${step.type} ${summary}` : step.type
    segments.push({ label, path: partialPath })
  }

  return segments
}

/** Formats the breadcrumb segments as a single " › "-separated string. */
export function breadcrumbText(
  steps: FlowStep[],
  path: StepPath,
  flowName?: string,
): string {
  return buildBreadcrumb(steps, path, flowName)
    .map((s) => s.label)
    .join(" › ")
}

/**
 * Returns true when the current steps differ from the saved snapshot.
 * Uses reference identity first (fast path), then JSON comparison.
 */
export function isDirtySteps(saved: FlowStep[], current: FlowStep[]): boolean {
  if (saved === current) return false
  return JSON.stringify(saved) !== JSON.stringify(current)
}
