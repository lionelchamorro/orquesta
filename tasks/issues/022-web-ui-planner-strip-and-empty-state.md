# [022] Web UI planner-mode strip + EmptyState across TUI + Web UI

**Labels:** `web-ui`, `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Remove the planner-mode UI from both surfaces (per ADR-0001) and replace the empty state with a static "no run yet — run `orq import <file>`" placeholder. End-to-end: opening the Web UI or TUI when there is no Run shows the EmptyState message; the user runs `orq import sample.json && orq start` (#014) and both UIs transition cleanly into run mode without ever touching a planner prompt.

The daemon's `PlannerService`, `/api/plan`, `/api/approve`, and the `planner` role remain intact (ADR-0001). Only UI surfaces are removed.

## Acceptance criteria

- [ ] Web UI: `PlanPrompt.tsx` deleted; `mode === "empty"` and `mode === "planner"` branches removed from `App.tsx`; planner state removed from `useRunState`.
- [ ] Web UI: new `EmptyState.tsx` rendered when `mode === "empty"`, with the "run `orq import`" copy and a link to the PRD/CONTEXT.md.
- [ ] Web UI: the "Approve & Start" banner is removed; Runs land already `approved` via the import shim.
- [ ] TUI: full-screen empty placeholder rendered when no Run exists, with the same "run `orq import`" copy.
- [ ] No console errors on the Web UI when the Run transitions empty → run via import.
- [ ] Existing Web UI tests that referenced PlanPrompt / planner mode are updated; no new tests required.
- [ ] Both UIs verified manually: opening fresh, importing a sample DAG, the empty state replaces with run state without a refresh.

## Blocked by

- [#014](014-daemon-import-shim.md)
