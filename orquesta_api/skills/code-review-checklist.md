id: code-review-checklist
name: Code Review Checklist
description: Concrete review checklist for critic and reviewer roles.
suggested_roles: critic, reviewer

Review the change for hidden assumptions: inputs that are trusted without validation, timing or ordering assumptions, default values that may differ in production, and contracts that are implied but not enforced.

Trace error paths as carefully as success paths. Check external I/O, filesystem access, network calls, subprocesses, retries, cancellation, partial writes, and cleanup after failures.

Verify tests assert observable behavior through public interfaces rather than private implementation details. Prefer tests that would catch a real regression over tests that mirror the current code structure.

Inspect security-sensitive sinks: shell commands, path joins, file writes, environment handling, logs, auth decisions, SQL or query construction, template rendering, and user-controlled data crossing trust boundaries.
