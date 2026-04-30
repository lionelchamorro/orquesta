# [019] TUI chat overlay (`/`)

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

A `/`-triggered chat composer overlay that sends a PM-style message to the currently-selected agent. End-to-end: with the cursor on an agent (live or dead), pressing `/` opens a one-line input at the bottom of the screen; typing and pressing `enter` posts to `POST /api/agents/:id/input` with `role: "pm"`; `esc` cancels the overlay without sending.

## Acceptance criteria

- [ ] `/` opens the overlay only when an agent is selected; otherwise no-op with a footer hint.
- [ ] Overlay shows the target agent ID and role at the top, an input line below, and short send/cancel hints.
- [ ] `enter` POSTs to `/api/agents/:id/input` with `{ text, role: "pm" }`; success closes the overlay; failure shows an inline error and keeps the overlay open with the typed text.
- [ ] `esc` closes the overlay without sending.
- [ ] When the overlay is open, list/right-pane keys are intercepted (typing into chat does not move the cursor).

## Blocked by

- [#015](015-tui-agent-detail-on-cursor.md)
