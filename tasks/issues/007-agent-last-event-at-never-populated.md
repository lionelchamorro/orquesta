# [P2] `Agent.last_event_at` is never populated

**Labels:** `bug`, `priority:medium`, `state`, `agents`

## Summary

The agent record persisted to `.orquesta/crew/agents/<id>.json` exposes a `last_event_at` field that always reads `null`, even after an agent has emitted hundreds of events (and after it has died). Only `last_activity_at` is updated, and only via `report_progress` calls.

## Reproduction

After a run, inspect any agent JSON:

```bash
$ cat /tmp/orq-<id>/.orquesta/crew/agents/<id>.json | jq '{role, status, started_at, finished_at, last_event_at, last_activity_at}'
{
  "role": "coder",
  "status": "dead",
  "started_at": "2026-04-30T01:54:22.834Z",
  "finished_at": null,                    # see issue 008
  "last_event_at": null,                  # never set
  "last_activity_at": "2026-04-30T01:57:51.226Z"
}
```

Despite this agent being responsible for 200+ `subtask_output` events plus `subtask_started` and `subtask_completed`.

## Root cause

`AgentPool` (`src/agents/pool.ts`) updates `last_activity_at` only on `report_progress` (via `mcp/tools.ts:report_progress` → `store.saveAgent`). The PTY chunk handler that emits `subtask_output` does **not** update the agent record. There is no code path that ever writes `last_event_at`.

## Expected behavior

Either:

- Drop `last_event_at` from the schema if it is redundant.
- OR have `AgentPool`'s output handler bump `last_event_at` on every chunk (debounced, e.g. once per second to avoid hammering the disk).

The dashboard (UI) and the test script's "live agents" list will both benefit from a real `last seen` timestamp; right now `last_activity_at` only moves on coarse `report_progress` calls.

## Affected files

- `src/agents/pool.ts:60-90`
- `src/core/types.ts` (Agent schema)
- `src/core/plan-store.ts` (saveAgent)

## Acceptance criteria

- [ ] After an agent emits stdout, `last_event_at` advances.
- [ ] No more than one disk write per second per agent due to chunk-driven updates.
