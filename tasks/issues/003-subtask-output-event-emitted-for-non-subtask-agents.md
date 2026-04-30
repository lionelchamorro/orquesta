# [P2] `subtask_output` event published with empty `subtaskId` for non-subtask agents

**Labels:** `bug`, `priority:medium`, `bus`, `events`, `naming`

## Summary

The agent pool emits a `subtask_output` event for **every** terminal output chunk from **every** agent — including the planner, which has no subtask. The result is hundreds of `subtask_output` events with `payload.subtaskId === ""`, tagged with the planner role. This pollutes the journal, makes per-subtask filters unreliable, and forces every consumer to filter out empty `subtaskId` events.

## Reproduction

```bash
ORQ_TEST_TIMEOUT_SECONDS=600 ORQ_PORT=8011 \
  bash scripts/test-daemon-flow.sh
```

After the planner finishes:

```bash
curl -fsS http://localhost:8011/api/export | \
  jq '[.events[] | select(.payload.type == "subtask_output" and .payload.subtaskId == "")] | length'
# → tens of events from the planner alone
```

In the test output you can see lines like:

```
41 2026-04-30T01:54:21.907Z subtask_output fe9af172-...,planner
46 2026-04-30T01:54:21.942Z subtask_output fe9af172-...,planner
48 2026-04-30T01:54:22.631Z subtask_output fe9af172-...,planner
```

— all tagged `planner`, with no `task-*` or `sub-*` tag, and `subtaskId === ""` in the payload.

## Root cause

`src/agents/pool.ts:79`:

```ts
this.bus.publish({
  tags: [id, role, options.taskId ?? "", options.subtaskId ?? ""].filter(Boolean),
  payload: { type: "subtask_output", subtaskId: options.subtaskId ?? "", chunk: text },
});
```

Every chunk of stdout/stderr from the agent's pty becomes a `subtask_output` event, regardless of whether the agent has a `subtaskId`. The empty-string fallback makes the event well-formed type-wise but semantically meaningless.

## Expected behavior

Either:

- **Rename + split**: emit `agent_output` for general agent stream output and `subtask_output` only when `options.subtaskId` is set. Update `src/core/types.ts:152` to reflect the split.
- Or: drop the empty-string event entirely when there's no `subtaskId`. Planner output should be journaled as a different type (`planner_output` or `agent_stream`) so consumers can filter cleanly.

The current `payload.subtaskId: ""` value should be impossible at the type level — `subtaskId` should be `string` (non-empty) on a `subtask_output` event, or the variant should be tagged differently.

## Side effect — `subtask_output` is far too noisy

Aggregated event-type counts after a single task in the smoke test:

```
subtask_output     252
activity             4
subtask_started      2
subtask_completed    2 (duplicated, see issue 002)
tasks_emitted        1
task_ready           1
plan_approved        1
```

`subtask_output` accounts for ~99% of all events. Each event carries a partial PTY chunk (often a fragment of a JSON line that has to be reassembled by the consumer). The journal table grows extremely fast and `/api/export` returns 1000-event windows that consist almost entirely of fragments.

Consider buffering chunks until newline before journaling, or only journaling the parsed `parseLineFor()` outputs (which the pool already computes for `agentMetrics`).

## Affected files

- `src/agents/pool.ts:78-82`
- `src/core/types.ts:152` (variant definition)
- `src/ui/utils/eventLabel.ts:18` and `src/ui/hooks/useRunState.ts:104` (consumers)

## Acceptance criteria

- [ ] No `subtask_output` event with `subtaskId === ""` in the journal after a normal run.
- [ ] Planner output is observable via a separate, well-named event type.
- [ ] Journal volume per task drops by ≥10× from the current state (line-buffered emission).
