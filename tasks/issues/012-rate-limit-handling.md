# [P2] Daemon does not recognize Anthropic 429 / rate-limit failures and burns retry iterations

**Labels:** `bug`, `priority:medium`, `daemon`, `agents`, `cost`

## Summary

When an agent's Claude CLI exits with `api_error_status: 429` ("You've hit your org's monthly usage limit"), the daemon treats it as a generic subtask failure. It then fires the next iteration, spawns fresh `architect` / `pm` / `qa` agents to refine the plan — and *every one* of those agents immediately hits the same 429. The result is a cascade of zero-progress retries that exit within seconds, before the daemon eventually marks the run `failed`. Cleanup is correct, but the operator sees a confusing "subtask failed → iteration 2 started → run failed" sequence with no indication that the actual cause is quota exhaustion.

## Reproduction (observed)

Smoke run on 2026-04-30 02:30 UTC. Tester sub-2 of task-3 received:

```json
{
  "type":"rate_limit_event",
  "rate_limit_info":{
    "status":"rejected",
    "resetsAt":1777524000,
    "rateLimitType":"five_hour",
    "overageStatus":"rejected"
  }
}
{
  "type":"result",
  "is_error":true,
  "api_error_status":429,
  "result":"You've hit your org's monthly usage limit"
}
```

The daemon's response (events 296–320 in journal):

```
296 02:30:03 activity         "Subtask sub-2 failed"
297 02:30:04 iteration_started iter-1
298–304     agent_output       architect (~7 lines, then dies on 429)
305–311     agent_output       pm        (~7 lines, then dies on 429)
312–318     agent_output       qa        (~7 lines, then dies on 429)
319 02:30:17 iteration_completed
320 02:30:17 run_completed
```

So three agents got spawned just to be killed by the same rate limit — and the operator sees `[test] final status=failed` with no explanation.

## Expected behavior

1. The agent pool / `parseLineFor` already inspects the result line for metrics. Extend it to detect `api_error_status === 429` or `rate_limit_event.status === "rejected"`.
2. When detected, classify the failure as `quota_exceeded`, attach `rate_limit_resets_at` to the agent and (if the agent is a coder/tester/critic) propagate it onto the failing subtask and task.
3. The orchestrator / iteration manager should refuse to start a new iteration when the most recent failure is `quota_exceeded`. Mark the plan `failed` (or a new status `failed_quota`) immediately and emit a single, clear `activity` event:

   ```
   Run halted: API quota exhausted (5h window). Resumes at 2026-04-30T04:00:00Z. Re-run after that time.
   ```

4. The CLI / dashboard should surface this distinct state instead of a generic "failed".

## Suggested code surface

- `src/agents/adapters/claude.ts` — `parseLineFor` already extracts `is_error`, `stop_reason`, `total_cost_usd`. Add `api_error_status`, `rate_limit_status`, `rate_limit_resets_at`.
- `src/agents/pool.ts` — when terminal exits with `metrics.api_error_status === 429`, save the agent with `error: "quota_exceeded"` and a `rate_limit_resets_at` field.
- `src/daemon/task-pipeline.ts:waitForSubtask` — translate quota errors into `subtask_failed` with `reason: "quota_exceeded"`.
- `src/daemon/iteration-manager.ts` — don't start a new iteration when any subtask in the previous iteration failed with `reason: "quota_exceeded"`.
- `src/api/http.ts` `/api/diagnostics` — surface `quota: { resets_at }` if known.

## Acceptance criteria

- [ ] When an agent hits 429, exactly one agent is spawned (no architect/pm/qa cascade).
- [ ] Plan transitions to `failed` (or `failed_quota`) within seconds of the first 429.
- [ ] `/api/diagnostics` and the test-script summary expose the resets_at timestamp.
- [ ] Re-running after `resets_at` proceeds normally.

## Related

- Surfaced during verification of issues 001–011 (see `VERIFICATION-v2.md`).
