# [016] TUI activity feed (cursor-filtered, right pane default)

**Labels:** `tui`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Populate the right-pane `Activity` mode (introduced as a placeholder in #015) with a real journal-driven activity feed that filters automatically based on what the cursor is on. End-to-end: with the cursor parked on a Task the feed shows only that Task's events; on an Agent only that Agent's events; on neither, all events for the current iteration. Events stream in live; the viewport from #013 is reused for scrolling history.

## Acceptance criteria

- [ ] The right pane shows the Activity feed by default whenever the cursor is not on an agent.
- [ ] When the cursor is on an agent, the right pane shows `AgentDetail` (from #015), not Activity. (The Activity pane returns when the cursor leaves the agent.)
- [ ] When cursor is on a task, the activity feed renders only events tagged with that task ID.
- [ ] When cursor is on neither tasks nor agents, the feed shows events for the currently-displayed iteration.
- [ ] Events stream in live as they arrive; user can scroll back through history without losing the live tail.
- [ ] The feed reuses the `viewport` module from #013.
- [ ] Tests cover the cursor-driven filter resolution (selection → filter predicate) as a pure function.

## Blocked by

- [#015](015-tui-agent-detail-on-cursor.md)
