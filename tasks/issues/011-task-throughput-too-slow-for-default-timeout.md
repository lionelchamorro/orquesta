# [P3] Default `ORQ_TEST_TIMEOUT_SECONDS=1800` is barely enough for a 9-task plan

**Labels:** `performance`, `priority:low`, `tests`, `dx`

## Summary

Running `scripts/test-daemon-flow.sh` with the prompt *"implement a golang api that mimics anthropic api"* produced a 9-task plan. Each task took **~4–5 minutes** end to end (coder → tester → critic). At that throughput, the full 9-task plan needs 36–45 minutes — exceeding the 30-minute default `ORQ_TEST_TIMEOUT_SECONDS=1800` and certainly the 10-minute timeout used in CI smoke tests.

## Reproduction (observed)

| Task | Started | Done | Duration |
|------|---------|------|----------|
| task-1: Scaffold Go module | 01:54:22 | 01:59:07 | 4m 45s |
| task-2: Define API types | 01:59:08 | 02:03:54 | 4m 46s |
| task-3: HTTP server / router | 02:03:54 | (timeout, still running at 600s mark) | — |

Only **2 of 9** tasks completed within the 10-minute test-script timeout. Extrapolating to 9 tasks: ~43 minutes wall clock.

## Why it's slow

- Tasks run **strictly sequentially** because the planner emits a fully serialized DAG (every task depends on the previous). The orchestrator is configured for `concurrency.workers = 2` but never has more than one ready task.
- Each task runs three serial subtasks (coder, tester, critic). Tester and critic also call out to the model.
- There is no model-side prompt caching or sub-agent reuse between phases of a task; each subtask is a fresh CLI process.

## Suggested directions

1. **Planner heuristic**: instruct the planner to declare independent tasks where possible (types, server, models, README, Dockerfile do not need to depend on each other). The current run had only one possible parallel pair (task-6 / task-7).
2. **Skip the tester+critic** when the diff is trivial (template scaffolding, `.gitignore`, `Makefile`-only changes). A `task.kind = "scaffold"` flag could let the pipeline short-circuit to coder-only.
3. **Default timeout**: bump `ORQ_TEST_TIMEOUT_SECONDS` to 3600, document expected wall clock per task in the README.

## Affected files

- `src/daemon/iteration-manager.ts` (planner prompt — line 78–90)
- `src/daemon/task-pipeline.ts` (tester/critic gating)
- `scripts/test-daemon-flow.sh:8` (default timeout)

## Acceptance criteria

- [ ] CI/dev smoke run defaults to a timeout that comfortably fits the slowest expected plan.
- [ ] Either: planner emits more parallel tasks for the canonical "implement X" prompt, or pipeline can opt out of tester/critic for scaffold tasks.
