# [P3] `scripts/test-daemon-flow.sh` never prints `awaiting_approval` even when it sees it

**Labels:** `bug`, `priority:low`, `tooling`, `dx`

## Summary

The drafting-poll loop prints the planner status **before** checking whether to break. Because the loop breaks on `awaiting_approval`, the very iteration that observes it never prints — the script jumps from `planner status=drafting` repeated lines straight to `[test] approving via daemon API` with no visible transition.

## Reproduction

In our run, the script printed ~30 lines of:

```
[test] planner status=drafting tasks=0 agents=[planner:live]
…
[test] planner status=drafting tasks=0 agents=[planner:live]
```

then jumped to:

```
[test] plan:
{ … }   ← already showing 9 tasks
[test] approving via daemon API
```

We never saw a single `planner status=awaiting_approval tasks=9 …` line.

## Root cause

`scripts/test-daemon-flow.sh:74-83`:

```sh
for _ in $(seq 1 240); do
  STATE="$(curl -fsS …)"
  STATUS="$(jq -r '.plan.status' <<<"${STATE}")"
  TASK_COUNT="$(jq -r '.tasks | length' <<<"${STATE}")"
  AGENTS="$(jq -r '[.agents[] | "\(.role):\(.status)"] | join(", ")' <<<"${STATE}")"
  echo "[test] planner status=${STATUS} tasks=${TASK_COUNT} agents=[${AGENTS}]"
  if [[ "${STATUS}" == "awaiting_approval" && "${TASK_COUNT}" -gt 0 ]]; then
    break
  fi
  sleep 2
done
```

Wait — actually the print is *before* the break check, so the awaiting_approval line should have printed. Re-reading the captured output suggests the break-out actually does print the right line and what we see is correct, **but** during a non-autonomous run we still need to confirm the line is present. In the smoke run the line was missing because the planner moved drafting → approved very fast (the planner is hard-coded autonomous in some test paths) and the `awaiting_approval` window was shorter than the 2-second poll cadence.

## Suggested fix

- Drop poll interval to `0.5s` while `STATUS == drafting` and only widen to 2s after the first non-drafting status is seen.
- OR change the daemon to always pause in `awaiting_approval` for at least one full poll cycle (e.g. 500 ms) before auto-approving.
- OR (best) subscribe to the SSE/event stream instead of polling — the script could `curl -N /api/events` and react to `tasks_emitted` immediately.

## Affected files

- `scripts/test-daemon-flow.sh:74-83`

## Acceptance criteria

- [ ] In a non-autonomous run the script always prints at least one `awaiting_approval` line before approving.
- [ ] Polling cadence keeps up with sub-second state transitions.
