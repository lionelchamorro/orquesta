# Backlog

Deferred findings from governance reviews. Never delete entries; skip if a title already exists.

---

## Concurrent drain test uses separate in-memory SQLite databases per connection

**Failure scenario:** `test_concurrent_drains_claim_oldest_queued_run_once` (test_run_queue.py:246) uses `sqlite+aiosqlite://` (in-memory). When `async with db() as session_a, db() as session_b:` holds two connections simultaneously, SQLAlchemy's pool creates a second aiosqlite connection that opens a fresh empty in-memory database. `session_b` calls `session.get(ProjectRow, project_id)` → returns `None` → returns early from `start_oldest_queued` with no data (not because the atomic claim worked). The test asserts `list(executor.started) == ["queued-once"]` and passes, but it's trivially true — session_b never competed. The conditional-UPDATE atomic claim is NOT exercised.

**Fix:** Use a file-based SQLite database for this test (as `test_concurrent_identical_webhooks_enqueue_one_row` does at line 978 with `tmp_path / 'webhook-race.sqlite'`). Alternatively, configure the engine with `StaticPool` to force a single shared connection.

**Tests to add:**
- Verify with a file-based DB that two concurrent `start_oldest_queued` calls on the same project result in exactly one `executor.start()` call and one `state=running` row, and the second caller returns without starting anything.

---

## `rewrite_prompt_skill_block` duplicates content when END marker precedes START marker

**Failure scenario:** A prompt file contains an orphaned END marker before an orphaned START marker (e.g., from manual editing: `"user prose\n<!-- orquesta:skills end -->\nmore prose\n<!-- orquesta:skills start -->\nextra"`). `rewrite_prompt_skill_block` enters the `start != -1 and end != -1` branch. `before = content[:start]` includes everything before START (including the orphaned END and the text "more prose"). `after = content[end + len(END_MARKER):]` includes everything after the first END (including "more prose" again, the START marker, and "extra"). After `_strip_orphaned_markers` removes only the marker strings, "more prose" appears in both `before` and `after` — it gets written twice into the output file.

**Fix:** Detect the inverted case (`end < start`) before entering the well-formed block branch. In the inverted case, fall through to the `cleaned = _strip_orphaned_markers(content)` path (same as the "no valid block" path), which strips both orphaned markers and appends the replacement.

```python
if start != -1 and end != -1 and start < end:  # only enter if well-formed
    before = _strip_orphaned_markers(content[:start])
    after = _strip_orphaned_markers(content[end + len(END_MARKER):])
    return before + replacement + after
cleaned = _strip_orphaned_markers(content)
```

**Tests to add:**
- `rewrite_prompt_skill_block` on a file with END before START → non-managed content preserved exactly once, exactly one well-formed block.
- `rewrite_prompt_skill_block` on a file with orphaned END only (start == -1) → marker removed, content kept, replacement appended.

---

## `aggregator.py snapshot()` contains unreachable guard after `except*` handler

**Failure scenario:** Lines 91-92 check `if tasks_task is None or factory_task is None or cost_task is None: raise RuntimeError("snapshot task initialization failed")`. The three task variables are assigned inside the `async with asyncio.TaskGroup()` block. If the TaskGroup raises (caught by `except*`), the `except*` handler always re-raises (`raise exc from None` or `raise exc_group.exceptions[0] from None`). Execution never reaches lines 91-92 via the exception path. If the TaskGroup succeeds (no exception), all three variables are non-None and the guard is trivially False. The guard is dead code and gives a misleading impression that the tasks could be `None` after a successful `except*` handling, which confuses future readers and makes the error-handling flow harder to audit.

**Fix:** Remove the dead guard (lines 91-92). Optionally, add a `# no cover: unreachable` comment at the top of the `except*` block or restructure to use `asyncio.gather` with `return_exceptions=True` for a simpler, more idiomatic parallel call.

**Tests to add:**
- `snapshot()` when one of the three HTTP calls raises `RuntimeError` → raises the same `RuntimeError` (not an ExceptionGroup).
- `snapshot()` when all three calls succeed → returns correct Snapshot.

---

## `run_tasks.track()` done-callback only discards — `_supervise` task exceptions silently lost

**Failure scenario:** `session.commit()` (line 204 of `runs.py`) or `_emit_lifecycle` (line 206) inside `_supervise` raises a DB error (e.g. connection reset). The exception propagates out of `_supervise` into the asyncio Task. The sole done-callback — `SUPERVISOR_TASKS.discard` — removes the task from the set; the exception is never logged. Python may eventually emit "Task exception was never retrieved" when the task is GC'd (non-deterministic, not structured). Result: the run stays in `state='running'` forever, `project.state` stays `'running'`, all queued runs for that project are blocked until the next API restart.

**Fix:** Add an exception-logging done-callback in `run_tasks.track()`:
```python
def _log_task_exc(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and (exc := task.exception()) is not None:
        logger.exception("Supervisor task raised unhandled exception", exc_info=exc)

def track(task: asyncio.Task[None]) -> None:
    SUPERVISOR_TASKS.add(task)
    task.add_done_callback(SUPERVISOR_TASKS.discard)
    task.add_done_callback(_log_task_exc)
```

**Tests to add:**
- `track()` on a task that raises → exception is logged (caplog captures it) and task is removed from the set.

---

## `_reconcile()` blocks GET /runs/{id} while draining the queue

**Failure scenario:** `GET /runs/{id}` is called after an API restart while a queued run exists. `_reconcile` detects the run is dead (executor has no live process), commits a terminal state, then synchronously `await`s `_drain_queue` which calls `ensure_workspace_ready` (may run `orq-lite init`, a subprocess taking several seconds) and `executor.start()`. The HTTP client waits the full duration; if the workspace init is slow (cold clone), the GET can block 10–30 s with no indication why.

**Fix:** Fire-and-forget inside `_reconcile` using the same `_track` mechanism as `start_run_row`:
```python
task = asyncio.create_task(self._drain_queue(row.project_id, row.id, "_reconcile"))
_track(task)
```
`_drain_queue` already catches and logs all exceptions, so no error surface changes.

**Tests to add:**
- `get()` on a reconciled run with a queued successor returns immediately (before the successor starts).

---

## `_orq_run_summaries_by_id` fetches all project runs — O(total/50) HTTP calls for review listing

**Failure scenario:** `GET /projects/{id}/reviews` for a project with 10,000 historical runs (most from `factory`/`issue_fix` flows) makes `ceil(10000/50) = 200` sequential `list_runs` HTTP calls to the serve just to look up cost and duration for 5 `pr_review` rows. Wall time grows linearly with project history length, risking a slow or timed-out reviews tab in long-running projects.

**Fix:** Either (a) pass the `orq_run_id` values actually needed as a filter to `agg.list_runs` (if the serve API supports `?run_ids=...`), or (b) iterate only up to a page that covers the number of `pr_review` rows seen in the DB (stop once all orq_run_ids referenced by `rows` are found in `summaries`), or (c) call `agg.get_run` per row but in parallel (N targeted calls instead of N/50 scan). Option (b) is the safest without serve API changes: stop as soon as `{r.orq_run_id for r in rows} ⊆ summaries`.

**Tests to add:**
- Serve has 200 historical runs; only 3 are pr_review rows. Assert pagination terminates after finding all 3 orq_run_ids (not after 4 full pages).

---

## `queue_run` IntegrityError propagates as 500 for concurrent identical manual API launches

**Failure scenario:** Two concurrent `POST /projects/{id}/runs` requests with identical `flow` and `inputs` while the project has an active run. Both pass the `existing.scalars().first() is not None` check in `launch()`, both hit the "existing active/queued run" branch, both call `queue_run()`. The first succeeds; the second triggers `IntegrityError` from the `uq_runs_queued_flow_inputs` partial unique index. This exception propagates unhandled through `RunSupervisor.launch()` and the router — no `IntegrityError` handler is registered in `_register_exception_handlers` — resulting in a 500 response. (Webhook path correctly catches this in `_launch_flow`'s `except IntegrityError` block; the manual API path does not.)

**Fix:** Add a catch for `IntegrityError` in `RunSupervisor.launch()` after the `queue_run()` call in the existing-active-run branch, returning a `queued` Run (same as the webhook path does) or re-raising as `FileExistsError` so the 409 handler fires:
```python
if existing.scalars().first() is not None:
    if queue:
        try:
            return _row_to_model(await queue_run(...))
        except IntegrityError:
            await self._session.rollback()
            # identical queued run was just inserted concurrently
            raise FileExistsError(...)
    raise FileExistsError(...)
```

**Tests to add:**
- Two concurrent `launch(..., queue=True)` calls with identical flow+inputs while an active run exists → exactly one queued row, no 500 errors.

---

## TOCTOU race between `preview_update` and `update` in `update_with_skills`

**Failure scenario:** Two concurrent `PUT /teams/{project_id}` requests for the same project. Request A calls `preview_update` (reads `team.json`), validates the merged result. Before A calls `store.update`, Request B also validates and calls `store.update`, writing a new `team.json` that adds a role referencing a deleted skill ID. Request A then calls `store.update`, reading the freshly-written `team.json` from B, deep-merging A's patch on top — the resulting write can contain a role with an unknown skill ID that A's validation never saw. `compose_role_prompt_file_async` then raises inside the for-loop for that role.

**Fix:** Introduce a per-workspace file lock around the validate+write window in `TeamConfigStore`, or combine `preview_update` and `update` into a single `validate_and_update` method that reads once, validates, and writes — all under the same lock.

**Tests to add:**
- Concurrent PUT requests where one introduces a deleted-skill role → only the first write succeeds; the second returns 422 (or is serialized safely).

---

## `stop()` of a running run does not drain the queue or reset project state (Docker executor)

**Failure scenario:** `run_executor=docker`. `DockerExecutor.start` returns `RunHandle(pid=None)` (docker.py:63), so `start_run_row` never creates a `_supervise` task — Docker runs are only ever finalized lazily by `_reconcile`. A running run is stopped via `POST /runs/{id}/stop`. The running-terminal path in `stop()` (runs.py:282-294) sets `state=cancelled`, commits, and returns WITHOUT calling `_drain_queue` and without touching `project.state`. No supervisor exists to do either, and `_reconcile` only drains when it itself transitions a row to terminal — the row is already cancelled, so it returns early. Result: `project.state` stays `"running"` indefinitely and every queued run for that project is stranded until the next API restart's `reconcile()`. The local executor is unaffected because `_supervise` (runs.py:193-208) handles the reset+drain.

**Fix:** In `stop()`'s running-terminal path, set `project.state` (idle for the cancelled branch; idle/needs_human by exit code for the natural-exit branch) and call the guarded `_drain_queue(...)`, mirroring `_supervise`. Guard against double-drain when a supervisor task also fires — the conditional-UPDATE claim in `start_oldest_queued` already makes a second concurrent drain a no-op.

**Tests to add:**
- With a no-`pid` (Docker-style) executor fake, launch a run + queue a second, stop the running run → the stopped project returns to a non-running state and the queued run is started.

---

## `inputs_hash` migration builds a UNIQUE index without collapsing pre-existing duplicate queued rows

**Failure scenario:** A production DB predating migration `8b6207a5a1d4` holds two or more `state='queued'` rows with identical `(project_id, flow, inputs)` — exactly the duplicates round-1's Python-only dedup race could leave behind (the reason the DB index is being introduced). After backfilling `inputs_hash`, `op.create_index("uq_runs_queued_flow_inputs", ..., unique=True, ...where state='queued')` (migration line ~80) raises `IntegrityError`; the Alembic upgrade fails, `ensure_schema_current()` in `main.py` `_lifespan` re-raises, and the API refuses to start. CI does not catch it because migrations run against a fresh, empty DB.

**Fix:** Before `create_index`, de-duplicate: for each `(project_id, flow, inputs_hash)` group of `state='queued'` rows, keep the oldest (by `queued_at`, then `id`) and cancel/delete the rest, so the unique index can be built. If the active-vs-queued index-broadening backlog item is taken, collapse across the widened predicate instead.

**Tests to add:**
- Migration `upgrade` (and `downgrade`) against a DB seeded with duplicate queued rows → upgrade collapses duplicates and builds the index without error.
