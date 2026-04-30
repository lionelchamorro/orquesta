# [020] TUI ask toast

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

An ephemeral top-right notification when an agent raises an ask that needs a human answer, plus a quick way to jump to that agent. End-to-end: when the daemon publishes an ask event, a toast appears with the asking agent's ID, role, and question summary. Pressing `enter` while the toast is visible moves the list cursor to the asking agent and dismisses the toast; otherwise the toast auto-dismisses after a short timeout.

## Acceptance criteria

- [ ] Toast appears within 500ms of an `ask_*` event arriving on the bus.
- [ ] Multiple concurrent asks stack vertically in the corner; oldest at the top.
- [ ] `enter` jumps the cursor to the latest toast's agent and dismisses that toast.
- [ ] Toast auto-dismisses after a configurable timeout (default 30s).
- [ ] Dismissed toasts no longer reappear if the underlying ask is still pending; a digest indicator on the footer (e.g. "2 asks pending") replaces them.
- [ ] Toasts are non-blocking: list and right-pane interaction continues working while toasts are visible.

## Blocked by

- [#015](015-tui-agent-detail-on-cursor.md)
