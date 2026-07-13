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
