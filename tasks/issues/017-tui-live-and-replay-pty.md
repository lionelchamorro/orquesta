# [017] TUI live + replay PTY on `enter`

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Wire up the `LivePTY` and `ReplayPTY` modes of the right-pane state machine. End-to-end: pressing `enter` on a *live* agent attaches to its PTY WebSocket and streams output below the info card; pressing `enter` on a *dead* agent shows the daemon's already-cached 200 KB scrollback in read-only mode. `esc` returns the right pane to `AgentDetail` (then `Activity` when the cursor leaves the agent).

No daemon changes — the `/tty/:agentId` endpoint already serves both live PTY for live agents and the cached scrollback for dead ones.

## Acceptance criteria

- [ ] `enter` on a live agent → mode `LivePTY`; PTY output streams in.
- [ ] `enter` on a dead agent → mode `ReplayPTY`; cached scrollback renders read-only with a banner indicating "exited · replay".
- [ ] `esc` returns to `AgentDetail`.
- [ ] Switching to a different agent (cursor move) while attached cleanly closes the previous PTY connection and reverts the pane to `AgentDetail` for the new selection.
- [ ] Dead-agent replay is clearly marked read-only — keystrokes are not forwarded.
- [ ] Live-agent input (typed keys) is forwarded to the PTY when in `LivePTY` mode.
- [ ] State-machine tests cover the `AgentDetail ↔ LivePTY ↔ AgentDetail` and `AgentDetail ↔ ReplayPTY ↔ AgentDetail` paths.

## Blocked by

- [#015](015-tui-agent-detail-on-cursor.md)
