# Orquesta Control-Plane Hardening

Features for the orquesta repo itself (Next.js 16 console + FastAPI control plane
for orq-lite). They come from the 2026-07-08 functional review: fix the production
blocker in the MCP bridge, stop losing webhook work, give the operator an
actionable inbox, surface PR-review outcomes, and add a composable skill library
for agent roles. Features are ordered by dependency — later ones build on earlier
ones on the same integration branch.

House rules for every feature: Python quality gate is
`uv run ruff check . && uv run ruff format --check . && uv run pytest`; frontend
gate (when `app/`, `components/` or `lib/` are touched) is
`pnpm typecheck && pnpm lint && pnpm test`. Pydantic models in
`orquesta_api/meta/models.py` mirror `lib/types.ts` field-for-field — any shape
change touches both in the same task. `team.json`/`flows.json` writes must stay
lossless raw read-modify-write (never drop unknown fields such as
`rate_limit_backoff` — regression tests exist in `test/test_config_roundtrip.py`).
Schema changes ship as Alembic migrations (test upgrade+downgrade in
`test/test_migrations.py`). No new Python or npm dependencies. Conventional
commit subjects. The prek/ast-grep standards in `CLAUDE.md` (CES rules) are
enforced by hooks — respect them rather than suppressing.

## Authenticated MCP bridge

The chat agent's MCP server calls the control plane without credentials, so every
tool call returns 401 the moment `AUTH_TOKEN` is configured — the chat only works
in unauthenticated dev today.

- In `orquesta_api/mcp/server.py`, the shared HTTP helper (`_call`, ~line 37)
  must send `Authorization: Bearer <token>` on every request. Read the token from
  the same source the API uses (`Settings().auth_token` via
  `orquesta_api.config.get_settings()`); when it is empty (dev), send no header.
- On a 401/403 response, the tool result must say explicitly that the MCP bridge
  is missing or has a wrong `AUTH_TOKEN` — not a generic HTTP error — so the chat
  agent can relay something actionable.
- Update `deploy/supervisord.conf` / `deploy/README.md` so the MCP process
  receives `AUTH_TOKEN` in its environment in the deploy image.
- Tests in `test/test_mcp_auth.py`: with a token configured, the outgoing request
  carries the bearer header (assert via `httpx.MockTransport` or a recording
  ASGI app); with an empty token, no `Authorization` header is sent; a 401
  upstream produces the actionable error text.

## Non-blocking git and atomic run admission

Two correctness fixes in the launch path that later features build on.

- `core/integrations/git.py` uses blocking `subprocess.run` from async handlers
  (`clone`, `fetch`, `checkout`, `merge_ff_only`, `status`). Make the boundary
  non-blocking: either wrap each call with `asyncio.to_thread` inside
  `RepoManager` (`services/repos.py`) or convert the module to
  `asyncio.create_subprocess_exec`. Callers' signatures stay async; behavior and
  error mapping (`RuntimeError` → 502) unchanged.
- The "one active run per project" check in `RunSupervisor.launch`
  (`services/runs.py`, SELECT-then-INSERT) is not atomic — concurrent requests
  can both pass it. Add a partial unique index on `runs(project_id)` restricted
  to active states (`queued`, `starting`, `running`, `stopping`) via an Alembic
  migration, and map the resulting `IntegrityError` to the existing
  `FileExistsError` → 409 contract.
- Tests: a concurrency test that fires two simultaneous launches and asserts
  exactly one run row is created and the other call gets 409; a migration
  upgrade/downgrade test; an event-loop-responsiveness test is not required, but
  `git.py` must no longer import-call `subprocess.run` directly from async code
  paths (assert via inspection or by running clone against a slow fixture repo
  while a trivial endpoint stays responsive).

## Per-project run queue

Today a second launch gets a hard 409 and — worse — GitHub webhook events arriving
while a run is active are dropped silently (`routers/webhooks.py`, the
`FileExistsError` branch). Replace "reject/drop" with a FIFO queue per project.

- `POST /projects/{id}/runs` gains `queue: bool = true`. When an active run
  exists and `queue` is true, persist the run as `state="queued"` (no pid, no
  started process) and return it; when `queue` is false, keep the current 409.
- Launch parameters must survive the wait: persist `flow`, `inputs`, `plan_path`
  and `args` on `RunRow` (Alembic migration) if not already stored, so a queued
  run can be started later exactly as requested.
- When `_supervise` finalizes a run, it starts the oldest queued run of the same
  project (its own DB session, same pattern as the supervisor). Startup
  reconciliation (`reconcile()`) must NOT mark queued rows as orphaned — they
  have no process — and must kick the queue for any idle project that has queued
  runs.
- Webhook handling (`services/watchers.py`): enqueue instead of dropping. Dedupe:
  if an identical queued run for the project already exists (same `flow` and
  `inputs`), skip enqueueing and log it.
- `POST /runs/{id}/stop` on a queued run transitions it straight to `cancelled`.
- Frontend: the project view lists queued runs with a cancel button;
  `components/console/flow-launcher.tsx` replaces its "run already active" 409
  path with "queued behind the active run" feedback. `RunState` in
  `lib/types.ts` already includes `queued`; no type change expected.
- Tests in `test/test_run_queue.py`: enqueue while active → queued row; finalize
  → queued run starts with the original flow/inputs; webhook while busy →
  queued, second identical webhook → deduped; stop on queued → cancelled;
  restart with a queued row → it launches once the project is idle.

## Needs-attention inbox

The dashboard shows stats but never answers "what needs me right now". Aggregate
everything requiring a human into one endpoint and one dashboard surface.

- `GET /attention` returns
  `{"items": [{kind, project_id, project_name, ref, title, detail, ts}]}` sorted
  newest-first, where `kind` is one of `run_failed` (latest failed run per
  project still in `needs_human` state, `ref` = run id, `detail` = error + last
  log lines), `task_needs_human` and `task_needs_clarification` (from the
  aggregator snapshot of each project with a live serve, `ref` = task id,
  `detail` = `failure_reason`). Projects whose serve is down contribute only
  their run items — never fail the whole endpoint because one project is
  unreachable.
- Retry: `POST /runs/{id}/retry` relaunches a finished run with its persisted
  parameters (depends on the queue feature's persisted launch params); it
  enqueues if the project is busy. Returns the new `Run`.
- Mirror the item shape in `lib/types.ts` (`AttentionItem`, `AttentionKind`).
- Frontend: a "Needs attention" section at the top of `/dashboard` (above the
  project grid) listing items with two actions per item: Retry (for
  `run_failed`, calls the retry endpoint with feedback) and View (links to the
  project's Runs/Tasks tab). Explicit empty state ("all clear"). Section hidden
  while loading, never blocks the rest of the dashboard.
- Tests: endpoint aggregation with a failed run + a fake serve snapshot
  containing `needs_human`/`needs_clarification` tasks; unreachable serve
  degrades gracefully; retry launches or enqueues with identical parameters.

## PR-review outcomes surface

The `pr_review` flow works but is invisible: the agent comments on GitHub and
Orquesta shows nothing. Make review runs first-class in the project view.

- Backend: `GET /projects/{id}/reviews` returns the project's runs with
  `kind="flow"` and `flow="pr_review"`, each as
  `{run_id, pr_number, pr_url, state, started_at, finished_at, duration_s,
  cost_usd}` — `pr_number` from the persisted `inputs`, `pr_url` constructed
  from the project's `repo_url` when it is a GitHub remote, cost/duration from
  the history correlation (`orq_run_id` → query API) when available, else null.
- Frontend: a "Reviews" tab in `components/console/project-view.tsx` listing
  review runs newest-first: PR number linked to GitHub, state badge, duration,
  cost, and a "Re-run review" button (relaunch/enqueue with the same
  `pr_number`). Empty state explains how reviews get triggered (PR watcher or
  manual `pr_review` launch).
- Mirror the response shape in `lib/types.ts`.
- Tests: endpoint filters only pr_review runs and builds `pr_url` correctly for
  https and ssh GitHub remotes; non-GitHub remote → `pr_url` null; re-run uses
  the persisted inputs.

## Role skills: composable prompt library

Each orq-lite role today gets one flat prompt file. Add a curated skill library
that Orquesta composes into role prompts, losslessly and idempotently — no
orq-lite changes required, since the engine just reads the final `.md` file.

- Skill catalog: `orquesta_api/skills/` in-repo, one markdown file per skill
  with a small header (first lines: `id`, `name`, `description`,
  `suggested_roles` comma list) followed by the instruction body. Ship four:
  `code-review-checklist` (critic/reviewer: concrete review checklist — hidden
  assumptions, error paths, tests asserting behavior not implementation,
  security-sensitive sinks), `tdd-workflow` (coder: failing test first, minimal
  code to green, refactor; never weaken an assertion to pass),
  `verification-evidence` (tester/verifier: a claim of "pass" must quote the
  command run and its actual output; no success claims without evidence),
  `repo-conventions` (all roles: read and honor the target repo's
  CLAUDE.md/AGENTS.md and lint config before writing code).
- `GET /skills` returns the parsed catalog
  (`{"skills": [{id, name, description, suggested_roles}]}`).
- `TeamRoleDefinition` gains optional `skills: list[str]` (mirror in
  `lib/types.ts`); the raw round-trip in
  `orquesta_api/services/config_files.py` must persist it like any other field.
- Composition on team save (PUT `/projects/{id}/team`): for each role with
  skills, rewrite the role's prompt file in the workspace appending one managed
  block delimited by `<!-- orquesta:skills start -->` /
  `<!-- orquesta:skills end -->` containing the selected skills' bodies in
  order. Regenerating replaces only the block; emptying `skills` removes the
  block; everything outside the markers is byte-for-byte untouched. Unknown
  skill ids → 422 listing them.
- Frontend: the role editor in `components/console/team-manager.tsx` gains a
  skill multi-select (name + description from `GET /skills`) and a read-only
  preview of the composed managed block.
- Tests in `test/test_skills.py`: catalog parsing; marker idempotency (compose
  twice → identical file); base prompt preserved outside markers; skill removal
  removes the block; team round-trip keeps `skills`; unknown id → 422.

## Console UX hardening

Production-polish pass on the weakest UI seams found in the review. Behavior
changes only — keep the existing visual language (dark, semantic
ok/warn/err/run palette, mono data).

- Mobile navigation: `components/console/console-sidebar.tsx` is `hidden` below
  `lg` with no alternative. Add a hamburger-triggered drawer (focus-trapped
  dialog, Escape closes) so every dashboard route is reachable on small
  viewports.
- Toast notifications: one lightweight toast provider (no new deps) used by
  `flow-launcher.tsx`, `flow-manager.tsx`, `team-manager.tsx` and
  `registry-table.tsx` for launched/saved/error feedback — auto-dismiss for
  success, sticky-until-dismissed for errors — replacing the persistent inline
  status text.
- Skeleton loading states for `/dashboard` and `/projects/[id]` (`loading.tsx`
  placeholders shaped like the real content instead of a bare "Loading…" line).
- Pagination: `tasks-table.tsx` and `run-history.tsx` paginate at 50 rows
  client-side with a "load more" control, so large projects don't render
  hundreds of DOM rows.
- Error normalization: one helper that maps fetch failures/API `detail` strings
  to a short human message with the raw detail available on demand, used by the
  components above instead of printing raw FastAPI errors.
- The Office HUD run button (`components/office/hud.tsx`) currently hardcodes
  `{kind: "factory"}` — reuse the FlowLauncher (or its flow-catalog logic) so
  the office launches the same flows as the project view.
- Tests: vitest coverage for the toast provider reducer/auto-dismiss, the
  pagination slice logic, and the error-normalization helper.
