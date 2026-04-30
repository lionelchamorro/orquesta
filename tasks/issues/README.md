# Issues — `scripts/test-daemon-flow.sh` smoke run

Logged on 2026-04-29 against branch `daemon-ui-refactor` (HEAD `95cbf1f`). Each file is a self-contained issue: title, repro, root cause, expected behavior, and acceptance criteria. Priorities are best-guess; please re-triage.

| # | Priority | Title | Tags |
|---|----------|-------|------|
| [001](001-no-worktree-when-target-not-git-repo.md) | P0 | Daemon silently runs without isolation when target dir is not a git repo | `daemon`, `safety`, `isolation` |
| [002](002-duplicate-subtask-completed-events.md) | P1 | `subtask_completed` events are emitted twice for every subtask | `bus`, `journal` |
| [009](009-tester-and-critic-rely-on-git-diff.md) | P1 | Tester / critic prompts rely on `git diff base..HEAD` and produce empty work in non-git roots | `agents`, `prompts` |
| [003](003-subtask-output-event-emitted-for-non-subtask-agents.md) | P2 | `subtask_output` event published with empty `subtaskId` for non-subtask agents | `events`, `naming` |
| [007](007-agent-last-event-at-never-populated.md) | P2 | `Agent.last_event_at` is never populated | `state`, `agents` |
| [008](008-dead-agent-finished-at-not-set.md) | P2 | Agents transition to `dead` without setting `finished_at` | `state`, `agents` |
| [010](010-diagnostics-knows-no-git-but-daemon-runs-anyway.md) | P2 | `/api/diagnostics` reports `git.repo: false` but the daemon still starts | `daemon`, `safety` |
| [004](004-test-script-recent-events-uses-wrong-payload-field.md) | P3 | Test script "recent events" panel always shows blank messages | `tooling`, `tests` |
| [005](005-test-script-silent-during-long-running-tasks.md) | P3 | Test script goes silent for minutes during long-running tasks | `tooling`, `dx` |
| [006](006-test-script-skips-printing-awaiting-approval.md) | P3 | Test script never prints `awaiting_approval` even when it sees it | `tooling`, `dx` |
| [011](011-task-throughput-too-slow-for-default-timeout.md) | P3 | Default `ORQ_TEST_TIMEOUT_SECONDS=1800` is barely enough for a 9-task plan | `performance`, `tests` |
| [012](012-rate-limit-handling.md) | P2 | Daemon does not recognize Anthropic 429 / rate-limit failures and burns retry iterations | `daemon`, `agents`, `cost` |

See [`VERIFICATION-v2.md`](VERIFICATION-v2.md) for the post-fix smoke-run verification and which issues are confirmed fixed.

## TUI fix + planner UI strip (PRD-0001)

Vertical-slice tickets decomposed from [`tasks/prd/0001-tui-fix-and-planner-ui-strip.md`](../prd/0001-tui-fix-and-planner-ui-strip.md). All `needs-triage` and `afk`. Each row links the local spec file and its GitHub issue.

| Local | GH | Title | Blocked by |
|-------|----|-------|------------|
| [013](013-tui-scrolling-viewport.md) | [#1](https://github.com/lionelchamorro/orquesta/issues/1) | TUI scrolling viewport (fix list clipping) | — |
| [014](014-daemon-import-shim.md) | [#2](https://github.com/lionelchamorro/orquesta/issues/2) | Daemon import shim — `orq import` + `POST /api/tasks/import` | — |
| [015](015-tui-agent-detail-on-cursor.md) | [#3](https://github.com/lionelchamorro/orquesta/issues/3) | TUI agent detail on cursor (right-pane info card) | #1 |
| [016](016-tui-activity-feed-cursor-filtered.md) | [#4](https://github.com/lionelchamorro/orquesta/issues/4) | TUI activity feed (cursor-filtered, right-pane default) | #3 |
| [017](017-tui-live-and-replay-pty.md) | [#5](https://github.com/lionelchamorro/orquesta/issues/5) | TUI live + replay PTY on `enter` | #3 |
| [018](018-tui-resume-action.md) | [#6](https://github.com/lionelchamorro/orquesta/issues/6) | TUI resume action `R` | #5 |
| [019](019-tui-chat-overlay.md) | [#7](https://github.com/lionelchamorro/orquesta/issues/7) | TUI chat overlay (`/`) | #3 |
| [020](020-tui-ask-toast.md) | [#8](https://github.com/lionelchamorro/orquesta/issues/8) | TUI ask toast | #3 |
| [021](021-tui-iteration-nav.md) | [#9](https://github.com/lionelchamorro/orquesta/issues/9) | TUI iteration nav + header + footer | #1, #4 |
| [022](022-web-ui-planner-strip-and-empty-state.md) | [#10](https://github.com/lionelchamorro/orquesta/issues/10) | Web UI planner-mode strip + EmptyState across TUI + Web UI | #2 |
| [023](023-tui-narrow-width-and-help.md) | [#11](https://github.com/lionelchamorro/orquesta/issues/11) | TUI narrow-width fallback + help overlay (`?`) | #3, #4, #7, #8, #9 |

## Test environment

- macOS 25.3.0 (Darwin), Bun 1.3.10
- `bun run typecheck` ✅ clean
- `bun test` ✅ 58 passing, 152 expects, 0 failing
- `bun run scripts/test-daemon-flow.sh` partial: completed 2 of 9 tasks before the 10-minute timeout we configured (default 30 min)

## Run summary

```
prompt:  implement a golang api that mimics anthropic api
runId:   run-moktxx9m-4200838f
target:  /tmp/orq-issue-test-1777514001    (NOT a git repo — see issue 001)
port:    8011

planner:  drafted 9 tasks (60s)            ✓
approval: auto-approved via /api/approve   ✓
task-1:   Scaffold Go module               4m 45s  done (no commit; non-git)
task-2:   Define API types                 4m 46s  done (no commit; non-git)
task-3:   HTTP server, router, auth        running at 10:00 timeout
tasks 4–9: pending
```

## Critical takeaways

1. **The smoke test as currently written produces fake-green results** (issues 001 + 009): the coder writes files directly to the daemon's CWD, the tester sees no git diff, and the task is marked `done` without any verification. The `bun test` and `bun run typecheck` suites are clean, but the end-to-end agent flow exhibits silent failure modes.
2. **The journal volume is dominated by partial PTY chunks** (issue 003): 252 of 256 events from a single completed task are `subtask_output` fragments with `subtaskId === ""` for the planner. Filtering and replay become expensive.
3. **Subtask completion is double-counted** (issue 002): every `subtask_completed` is journaled twice, so any aggregator that iterates events will report 2× the truth.

## What still works well

- `bun run typecheck` and `bun test` are green (58 unit tests, 0 failures).
- HTTP API is responsive: `/api/health`, `/api/diagnostics`, `/api/runs/current`, `/api/export`, `/api/approve` all behaved correctly.
- Planner produced a coherent 9-task plan in ~60 s.
- Coder agents produced reasonable Go code that `go build ./...` and `go test ./...` accepted (per the coder's self-reported verification).
- Daemon shutdown via `SIGTERM` from the test script's `trap cleanup EXIT` worked cleanly.
