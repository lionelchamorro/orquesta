# [018] TUI resume action `R`

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Add the `R` keybinding that re-launches an underlying CLI's own session (`claude --resume <id>` / `codex resume <id>`) inside the original worktree, exposed through the TUI's right pane. End-to-end: with the cursor on a resumable dead claude/codex agent, pressing `R` calls the existing `POST /api/agents/:id/resume` endpoint, the daemon spawns the resume PTY in the original `session_cwd`, and the TUI right pane attaches to it (`ResumedPTY` mode). The original agent's record (exit code, costs, captured session id) is preserved.

The daemon side is already implemented (`AgentPool.startResume` and the HTTP route exist; the Web UI uses them). This slice is the TUI consumer plus failure-mode UX.

## Acceptance criteria

- [ ] `R` is enabled only when the AgentDetail card shows "Resumable: yes". For not-resumable agents, `R` is a no-op with a footer hint explaining why.
- [ ] Pressing `R` POSTs to `/api/agents/:id/resume`; on success the right pane enters `ResumedPTY` mode attached to the new resume session.
- [ ] Failure modes show clear inline errors:
  - Gemini agent: "resume not supported for gemini (CLI lacks resume-by-stable-id)".
  - Worktree path no longer exists: "worktree no longer exists at <path>".
  - Missing `cli_session_id`: "no captured session id — agent exited before emitting one".
- [ ] The original agent's record is unchanged after resume; the resumed PTY is logged separately.
- [ ] State-machine tests cover `AgentDetail → ResumedPTY` and `AgentDetail → AgentDetail` (when resume rejected).

## Blocked by

- [#017](017-tui-live-and-replay-pty.md)
