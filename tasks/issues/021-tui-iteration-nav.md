# [021] TUI iteration nav + header + footer

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Add a persistent header bar (Run id, current iteration, status, max iterations) and a context-sensitive footer keymap, plus a global iteration filter driven by `[` and `]`. End-to-end: in a multi-iteration Run, pressing `[` / `]` shifts the displayed iteration; the Tasks list filters to that iteration's Tasks and the Activity feed (#016) re-filters to that iteration's events. Pinning an agent (`p`) keeps it visible across iteration changes.

## Acceptance criteria

- [ ] Header bar always shows: Run id, `Iter [N]/M`, plan status, plus `[<,>]`/`[?]`/`[q]` hints.
- [ ] `[` / `]` (and `,` / `.` aliases) decrement/increment the displayed iteration, clamped to `1..plan.max_iterations`.
- [ ] Tasks list filters to Tasks belonging to the displayed iteration.
- [ ] Activity feed (#016) re-filters to events belonging to the displayed iteration.
- [ ] `p` pins/unpins the selected agent; pinned agents remain in the agents list across iteration changes.
- [ ] Footer keymap reflects the current right-pane mode (e.g. `LivePTY` mode shows `[esc] back  [/] chat`; default mode shows `[enter] open agent  [/] chat  [,.] iter  [p] pin`).
- [ ] Iteration filtering is a pure function tested in isolation (Tasks/Events × iteration → filtered slice).

## Blocked by

- [#013](013-tui-scrolling-viewport.md)
- [#016](016-tui-activity-feed-cursor-filtered.md)
