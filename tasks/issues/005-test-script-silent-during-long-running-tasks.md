# [P3] `scripts/test-daemon-flow.sh` goes silent for minutes during long-running tasks

**Labels:** `bug`, `priority:low`, `tooling`, `dx`

## Summary

Once the run enters its monitoring loop, the script only prints when its `SUMMARY` string changes. `SUMMARY` is built only from plan status, completion counts, task statuses, and live agent IDs — none of which change while a single task is doing minutes of work. The result is that the script appears frozen for 5+ minutes between transitions, even though hundreds of events are streaming through the journal.

## Reproduction

Run `scripts/test-daemon-flow.sh`. Observe that after `task-1:running coder:live:…` is printed, **nothing else prints** until task-1 transitions to `done` and task-2 starts. In our run this gap was about 3.5 minutes. With a 30-minute default timeout the operator has no signal that anything is happening.

## Root cause

`scripts/test-daemon-flow.sh:117-130`:

```sh
SUMMARY="$(jq -r '
  "plan=\(.plan.status) completed=\(.plan.completed_count)/\(.plan.task_count)",
  ([.tasks[] | "\(.id):\(.status)"] | join(" ")),
  ([.agents[] | "\(.role):\(.status):\(.id[0:8])"] | join(" "))
' <<<"${STATE}")"

if [[ "${SUMMARY}" != "${LAST_SUMMARY}" ]]; then
  echo "----- $(date -u +%Y-%m-%dT%H:%M:%SZ) -----"
  …
fi
```

While a coder is working, none of these fields change. So the diff stays equal to `LAST_SUMMARY` and nothing prints.

## Suggested fix

Add periodic heartbeat output every N seconds regardless of summary changes — e.g. every 30 s print a one-line status:

```
[test] heartbeat 02:00:01Z plan=running completed=0/9 task-1=running events=252
```

A second improvement: include the latest `activity` event message in the summary — those carry "working: starting Go module scaffolding at project root" / "building: files written; running go vet, build, test", which are exactly the user-facing progress markers.

## Affected files

- `scripts/test-daemon-flow.sh:104-138`

## Acceptance criteria

- [ ] During a long-running task the script prints at least one heartbeat per 30 s.
- [ ] The heartbeat surfaces the latest activity message and event count.
