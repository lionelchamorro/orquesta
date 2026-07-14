/**
 * Typed chat scope — the single source of truth for session keying,
 * conversation IDs, header labels, and suggestion chips.
 *
 * "global" scope is the cross-project assistant (legacy default behaviour).
 * "project" scope is pinned to one project: it uses a separate opencode
 * session and conversation so the two never share state.
 */

export type ChatScope =
  | { readonly kind: "global" }
  | { readonly kind: "project"; readonly projectId: string }

/** Sentinel for the global scope — avoids constructing a new object on every render. */
export const GLOBAL_SCOPE: ChatScope = { kind: "global" } as const

/**
 * localStorage key for the opencode session ID within this scope.
 *
 * Collision-free: project IDs cannot contain "." so the namespaced key
 * can never collide with the global key.
 */
export function sessionStorageKey(scope: ChatScope): string {
  return scope.kind === "global"
    ? "orquesta.chat.session"
    : `orquesta.chat.session.project:${scope.projectId}`
}

/**
 * Stable identifier for the control-plane conversation record.
 *
 * "global" maps to the well-known cross-project conversation; project scopes
 * use the "project:{id}" prefix so they are queryable and filterable by project.
 */
export function conversationId(scope: ChatScope): string {
  return scope.kind === "global"
    ? "global"
    : `project:${scope.projectId}`
}

/** Header label shown in the chat pane's title bar. */
export function scopeLabel(scope: ChatScope): string {
  return scope.kind === "global"
    ? "Orquesta agent"
    : `Chat · ${scope.projectId}`
}

/** Suggestion chips rendered when the conversation has no messages yet. */
export function scopeSuggestions(scope: ChatScope): readonly string[] {
  if (scope.kind === "global") {
    return [
      "What projects need attention?",
      "List my projects",
      "Enable the PR watcher on prm",
      "Launch factory_fast on prm",
    ] as const
  }
  const { projectId } = scope
  return [
    `Add a feature to ${projectId}`,
    `Run factory on ${projectId}`,
    `Show the last run on ${projectId}`,
    `Why did the last run on ${projectId} fail?`,
  ] as const
}

/**
 * Returns the context hint to prepend to the first user message of a NEW
 * project-scoped session, so the orquesta agent knows which project is active
 * without requiring the user to name it.
 *
 * This string is sent inside the opencode `parts` payload but is NOT shown
 * in the UI message bubble (the UI renders the original `localUserTurn` text).
 *
 * Returns null for the global scope (no context injection needed).
 */
export function projectContextHint(scope: ChatScope): string | null {
  return scope.kind === "project"
    ? `[Active project: ${scope.projectId}]`
    : null
}
