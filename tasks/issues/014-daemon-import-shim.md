# [014] Daemon import shim — `orq import` + `POST /api/tasks/import`

**Labels:** `daemon`, `cli`, `enhancement`, `needs-triage`

## Parent

[`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md)

## What to build

Add a minimal task-ingestion path that lets a developer start a Run from a pre-built Task DAG without going through the planner agent. End-to-end: `orq import sample.json && orq start` results in a Run with `status: approved`, `current_iteration: 1`, the supplied Tasks, and the orchestrator running them through the existing pipeline. Validators and iteration-boundary auto-improvement remain unchanged (per ADR-0001).

The implementation is a single deep module (`task-import.ts`) called by both an HTTP route and the CLI subcommand.

## Acceptance criteria

- [ ] New `task-import` module validates the imported payload via Zod (reusing existing `Task` / `Plan` schemas) and writes `Plan` + `Task[]` + an iteration-1 row atomically through `PlanStore`.
- [ ] Cycle detection and missing-dependency detection reject malformed DAGs with structured errors; no partial state is written.
- [ ] Importing while a Run is `running` is rejected with a `run_in_progress` error.
- [ ] Importing when the previous Run is in a terminal state cleanly overwrites the prior Run's tasks/iterations/agents (mirroring `clearPreviousTasks`).
- [ ] `POST /api/tasks/import` is added to `mutatingRoutes`, token-gated, body-size-capped, returns `{ ok, runId }` or `{ ok: false, error: { code, message } }`.
- [ ] `orq import <file>` CLI subcommand POSTs to a running daemon, falls back to in-process import if no daemon is reachable (mirroring `orq plan`'s pattern).
- [ ] `orq doctor` reports "imported-run support: ok" and identifies whether the current Run was seeded by import or by the planner.
- [ ] Tests cover: happy path (writes the right shape), cycle rejection, missing-dependency rejection, run-in-progress rejection, token gate on the HTTP route.
- [ ] The PlannerService, `/api/plan`, `/api/approve`, and the `planner` role remain functional — this slice does not remove them (ADR-0001).

## Blocked by

None — can start immediately. Independent of the TUI work in #013.
