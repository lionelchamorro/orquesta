# [015] TUI agent detail on cursor (right pane info card)

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Establish the right-pane mode-switching infrastructure (per ADR-0002) and use it to render an Agent Detail info card whenever the user's cursor is on an agent. End-to-end: moving the cursor onto any agent in the list — live or dead — instantly shows a structured read-only view of that agent's bound task/subtask, role, CLI, model, status, exit code, stop reason, started/finished timestamps, durations, costs, captured `cli_session_id`, worktree path, and computed flags ("resumable: yes/no", "worktree exists: yes/no").

This issue is the gate for #017 (PTY), #018 (Resume), #019 (Chat), #020 (Toast), and #021 (Iteration nav) — all of which extend the right-pane state machine introduced here.

## Acceptance criteria

- [ ] A pure `right_pane` state-machine module exists with modes `Activity | AgentDetail | LivePTY | ReplayPTY | ResumedPTY` and explicit, tested transitions. Only `Activity` and `AgentDetail` are reachable in this slice; the others are stubs.
- [ ] Cursor on an agent → right pane mode `AgentDetail`; cursor off agents → right pane mode `Activity` (placeholder allowed for now; fully populated in #016).
- [ ] The info card renders all fields listed above; missing fields show as `—` rather than blank or `undefined`.
- [ ] "Resumable" is true when `cli_session_id` is set AND the CLI is `claude` or `codex` AND `session_cwd` exists on disk; false otherwise. The card states the reason when false.
- [ ] State-machine unit tests verify legal transitions, illegal-transition rejection, and the resumable-flag derivation.

## Blocked by

- [#013](013-tui-scrolling-viewport.md)
