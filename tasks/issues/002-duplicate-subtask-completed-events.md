# [P1] `subtask_completed` events are emitted twice for every subtask

**Labels:** `bug`, `priority:high`, `bus`, `journal`

## Summary

Every `subtask_completed` event is journaled **twice**, ~10–20 ms apart, with different event IDs. This affects all subtask types observed in the test (coder, tester, critic). Downstream consumers that count completions, aggregate task outcomes, drive UI counters, or implement once-only side effects will be incorrect.

## Reproduction

Run `scripts/test-daemon-flow.sh`. Then query the journal directly:

```bash
sqlite3 /tmp/orq-<id>/.orquesta/crew/journal.sqlite \
  "SELECT id, event_id, ts, json_extract(payload, '\$.subtaskId') AS sub
   FROM events WHERE type='subtask_completed' ORDER BY id"
```

Output observed:

```
228|ab4e0103-…|2026-04-30T01:57:50.911Z|sub-1
232|f9a469e9-…|2026-04-30T01:57:50.930Z|sub-1   ← dup, +19ms
285|d7c516f7-…|2026-04-30T01:58:18.943Z|sub-2
288|8a83b11e-…|2026-04-30T01:58:18.951Z|sub-2   ← dup,  +8ms
371|ef2bc9f1-…|2026-04-30T01:59:07.463Z|sub-3
373|10763b24-…|2026-04-30T01:59:07.472Z|sub-3   ← dup,  +9ms
```

Both events have identical `tags`, identical `summary` strings, but distinct UUIDs and ms-apart timestamps.

## Investigation so far

- `Bus.publish` (`src/bus/bus.ts:27-44`) writes once per call — no internal duplication.
- `Journal.append` (`src/bus/journal.ts:22-26`) does a single INSERT — no internal duplication.
- Only two source-level publishers exist:
  - `src/mcp/tools.ts:353` (`report_complete` → coder/tester paths)
  - `src/mcp/tools.ts:394` (`request_review_subtask` → critic path)

So the second publish is happening from somewhere unexpected. Likely candidates:

1. The agent CLI is being asked twice (e.g. Claude Code retrying a tool call after a transport hiccup, or the model literally calling `report_complete` twice in the same turn).
2. The `tools/call` JSON-RPC handler at `src/mcp/server.ts:74-89` is being invoked twice for the same `id` (e.g. duplicate POST from the agent process).
3. `transitionSubtask` or some plan-store side effect is republishing through a different path that wasn't found in the grep.

The fact that all three subtasks (coder/tester/critic) are duplicated, and timestamps are 8–19 ms apart, suggests a transport-level or handler-level retry rather than an LLM idempotency bug.

## Expected behavior

`subtask_completed` is published exactly once per subtask transition to `done`.

## Suggested fix direction

- Add an idempotency guard at `Bus.publish`: if `event.id` is already journaled, drop. (Cheap, safe, addresses retry storms generally.)
- Or guard at the source: in `report_complete`, check `subtask.status === "done"` before publishing — if it's already done, the call is a duplicate and should return `{ ok: true }` without republishing.
- Log the JSON-RPC `id` and `Content-Length` of every MCP `tools/call` to confirm whether the duplicate is a transport retry.

## Affected files

- `src/mcp/tools.ts:325-356` (`report_complete`)
- `src/mcp/tools.ts:357-400` (`request_review_subtask`)
- `src/mcp/server.ts:74-89` (`tools/call` dispatch)
- `src/bus/bus.ts:27-44` (potential dedup point)

## Acceptance criteria

- [ ] One `subtask_completed` event per subtask in the journal after a full run.
- [ ] Test that simulates a duplicate JSON-RPC `tools/call` for `report_complete` and asserts a single bus publish.
