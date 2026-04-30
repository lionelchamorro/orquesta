# [P3] `scripts/test-daemon-flow.sh` "recent events" panel always shows blank messages

**Labels:** `bug`, `priority:low`, `tooling`, `tests`

## Summary

The `[test] recent events:` block printed by the smoke-test script is supposed to show the latest events with their messages, but the message column is always empty. The script reads the wrong payload fields.

## Reproduction

Run the script and look at any `recent events` block:

```
[test] recent events:
65 2026-04-30T01:54:25.294Z subtask_output 61041fed-...,coder,task-1,sub-1
66 2026-04-30T01:54:25.294Z subtask_output 61041fed-...,coder,task-1,sub-1
…
```

Note: there is no message after the tags. The intent of the line was to include a snippet of the event content.

## Root cause

`scripts/test-daemon-flow.sh:128`:

```sh
curl -fsS "http://localhost:${PORT}/api/export" \
  | jq -r '.events[-8:][]? | "\(.journal_id // "-") \(.ts) \(.payload.type) \(.tags | join(","))"'
```

This omits the chunk/message entirely. An earlier test path that I checked tried `.payload.message // .payload.content` — but the actual data on `subtask_output` events lives in `.payload.chunk`, on `activity` events in `.payload.message`, on `subtask_completed` in `.payload.summary`, etc. There is no single field that fits.

## Expected behavior

The recent-events block shows a short snippet of the most informative field per event type. Suggested jq:

```jq
.events[-8:][]? |
  ( .payload.message
    // .payload.summary
    // .payload.chunk
    // .payload.reason
    // ""
  ) as $msg |
  "\(.journal_id // "-") \(.ts) \(.payload.type) \(.tags | join(",")) \($msg | tostring | .[0:120])"
```

## Related issues

- This block prints fine for `task_ready`, `tasks_emitted`, `plan_approved` because those have no body field. The bug is only visible on chatty events (`subtask_output`, `subtask_completed`, `activity`).
- Combined with issue 005 (script goes silent during long-running tasks), the operator gets very little feedback during a live run.

## Affected files

- `scripts/test-daemon-flow.sh:127-130`

## Acceptance criteria

- [ ] `recent events` rows show a non-empty snippet for `activity`, `subtask_completed`, and `subtask_output` events.
- [ ] Script output is readable when streamed to a terminal (no JSON dumps on a single 2000-char line).
