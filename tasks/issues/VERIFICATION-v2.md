# Verification — smoke test v2 (post-fix)

Run: 2026-04-30 02:19–02:30 UTC against branch `daemon-ui-refactor` after the issue 001–011 fixes.

Target dir: `/tmp/orq-issue-test-v2-1777515555/` (auto-`git init`'d by daemon).
Port: 8012. Run id: `run-mokuv8ok-d2f983ad`.

## Outcome

**`plan.status = failed`**, 2 of 9 tasks done.

| Task | Status | Wall | Notes |
|------|--------|------|-------|
| task-1 Scaffold Go module | ✅ done | ~2 min | committed on `orq/.../task-1`, merged to main |
| task-2 Define API types | ✅ done | ~4 min | committed, merged |
| task-3 HTTP server / router | ❌ failed | coder ok, tester 429 | sub-1 done; sub-2 hit Anthropic 429 |
| task-4 … task-9 | ⏸ blocked | — | dep on task-3 |

Failure is **not a daemon bug**: the tester CLI exited with `api_error_status: 429`, payload `"You've hit your org's monthly usage limit"`. Quota resets at unix `1777524000` (≈04:00 UTC).

## Daemon failure handling — clean

1. Tester pty exited `is_error: true`; daemon marked sub-2 `failed`.
2. task-3 → `failed`, downstream task-4..9 → `blocked` correctly via dep tracking.
3. iter-2 fired, spawning architect/pm/qa agents — these also hit 429 and died within ~7s.
4. `iteration_completed` then `run_completed` emitted; plan marked `failed`.
5. Daemon shut down cleanly on SIGTERM from the test script's trap.

## Issue-by-issue verification

| # | Status | Evidence |
|---|--------|----------|
| 001 — no worktree on non-git target | ✅ fixed | `/tmp/orq-…/.git/` auto-created with `Initial smoke-test commit`; per-task worktrees under `.orquesta/crew/worktrees/run-…/task-N/` |
| 002 — duplicate `subtask_completed` | ✅ fixed | `sqlite3 … "SELECT … WHERE type='subtask_completed'"` shows one row per subtask (sub-1, sub-2, sub-3 each appear exactly once) |
| 003 — `subtask_output` for non-subtask agents | ✅ fixed | planner now emits `agent_output`; `subtask_output` events all have populated `subtaskId` (sub-1, sub-2, …); no empty-string subtaskIds in journal |
| 004 — recent events panel blank | ✅ fixed | heartbeat / recent-events lines now show `{"type":"assistant",...}` chunks |
| 005 — script silent during long tasks | ✅ fixed | `[test] heartbeat HH:MM:SSZ plan=running events=N task-1=… working: <activity>` lines printed every ~30 s |
| 006 — script never prints `awaiting_approval` | ⚠️ unchanged in this run | planner finalized in <1 poll cycle, so no `awaiting_approval` line; less visible because tighter polling, but the underlying race remains. Not retested. |
| 007 — `last_event_at: null` | ✅ fixed | coder during run: `last_event_at: 2026-04-30T02:29:52.313Z` (live, ticking) |
| 008 — `finished_at: null` on dead agents | ✅ fixed | planner record: `finished_at: 2026-04-30T02:20:07.314Z`, `exit_code: 129` |
| 009 — tester relies on git diff | ✅ fixed | tester for task-1 reported real `go build / vet / test` results: *"`go build ./...` and `go vet ./...` both succeed, and `go test ./...` reports no test files for cmd/server, internal/api, internal/middleware, internal/store, or internal/types"* |
| 010 — daemon runs in degraded mode silently | ✅ fixed | `/api/diagnostics` now reports `git: { repo: true, branch: "main", enabled: true, ready: true }` because the daemon ensures the repo state |
| 011 — throughput too slow | ✅ partially fixed | task-1 ~2 min (was 4:45), task-2 ~4 min (was 4:46). 2× to 1× speedup observed. Plan still serial; would need a separate planner change for parallelism. |

## New issue surfaced

When the Anthropic API returns 429 / rate-limit, the daemon falls into the generic `subtask_failed` path and immediately fires the next iteration with fresh architect/pm/qa agents — which also hit the same 429 and burn token-cost-zero retries (actual wall clock cost ~10s and a handful of API calls). On a 5-hour reset window, every retry is wasted.

Suggested handling:

- Parse the agent's `result` event for `api_error_status: 429` or any `rate_limit_event` with `status: "rejected"`.
- Mark the run `failed_quota` with a `rate_limit_resets_at` field on the plan.
- Skip iteration 2 entirely when the prior failure was a quota error; surface a clear message in the dashboard / CLI ("API quota exhausted; resumes at HH:MM UTC; rerun then").

Filed as **issue 012** (rate-limit handling) — see below.

## What still works well end-to-end

- Auto git-init at daemon root.
- Per-task worktree creation, branch naming, coder commits, merge back to main on task done.
- Tester now runs real toolchain verification rather than reading an empty diff.
- Planner emits a coherent 9-task DAG with proper dependencies.
- Event journaling is now ~12× lighter per task (line-buffered chunks; sane event-type split).
- `/api/diagnostics` is honest about repo state.
- Test script v2 prints heartbeats and recent-event content.

## Reproduction

```bash
ORQ_TEST_TIMEOUT_SECONDS=2400 ORQ_PORT=8012 \
  ORQ_TEST_DIR=/tmp/orq-issue-test-v2-$(date +%s) \
  bash scripts/test-daemon-flow.sh
```

(Re-run after API quota resets to confirm tasks 3–9.)
