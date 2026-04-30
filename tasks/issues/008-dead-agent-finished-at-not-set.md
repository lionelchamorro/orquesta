# [P2] Agents transition to `status: "dead"` without setting `finished_at`

**Labels:** `bug`, `priority:medium`, `state`, `agents`

## Summary

When an agent's PTY exits, the agent pool persists `status: "dead"` and writes `exit_code`, but it does **not** set `finished_at`. The field stays `null` forever. This breaks any duration / wall-clock metric, and any UI that highlights "still running" agents.

## Reproduction

After a run, dead agents look like this:

```json
{
  "id": "fe9af172-…",
  "role": "planner",
  "status": "dead",
  "started_at": "2026-04-30T01:53:21.326Z",
  "finished_at": null,
  "exit_code": 129,
  "last_event_at": null
}
```

`exit_code: 129` indicates SIGHUP (signal 1), which is the planner being intentionally killed by `agentPool.kill(agentId)` after `report_complete`. The kill happens, but `finished_at` is never written.

## Root cause

`src/agents/pool.ts:91-119` (terminal exit handler):

```ts
terminal.exited.then(async () => {
  const exitCode = await terminal.exited;
  …
  await this.store.saveAgent({
    ...current,
    status: "dead",
    last_activity_at: new Date().toISOString(),
    exit_code: exitCode,
    …
  });
});
```

`finished_at` is in the schema (`src/core/types.ts`) but never assigned here.

## Expected behavior

Set `finished_at: new Date().toISOString()` in the same `saveAgent` call when transitioning to `dead`.

## Side note: signal 129 should be reported, not raw

`exit_code: 129` (= 128 + SIGHUP) is correct in POSIX terms but unhelpful for callers. Consider parsing into `{ exit_code, signal }` so the UI can distinguish "killed by orchestrator" from "exited cleanly with code 1".

## Affected files

- `src/agents/pool.ts:91-119`
- `src/core/types.ts` (Agent schema)

## Acceptance criteria

- [ ] After a run, every dead agent has `finished_at` set.
- [ ] `finished_at >= started_at` for all agents.
