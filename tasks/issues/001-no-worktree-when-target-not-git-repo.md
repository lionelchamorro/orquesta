# [P0] Daemon silently runs without isolation when target dir is not a git repo

**Labels:** `bug`, `priority:critical`, `isolation`, `daemon`, `safety`

## Summary

When the daemon is started in a directory that is not a git repository (or whose `baseBranch` doesn't exist), `ensureRepoReady()` returns `false` and **no per-task worktree is created**. The pipeline silently falls back to running every coder/tester/critic agent directly in the daemon's CWD, with zero isolation. The agent CLAUDE.md instructions still claim it is working in a worktree, so the model writes files at the project root, and the tester later sees no diff and reports "no coder output".

This was observed via `scripts/test-daemon-flow.sh` which runs in `/tmp/orq-<id>/` (not a git repo).

## Reproduction

```bash
ORQ_TEST_TIMEOUT_SECONDS=600 ORQ_PORT=8011 \
  bash scripts/test-daemon-flow.sh
# target dir defaults to /tmp/orq-<id>/ (not git-init'd)
```

After the coder runs, the daemon's CWD contains the source files directly:

```
/tmp/orq-issue-test-1777514001/
├── Makefile
├── cmd/server/...
├── go.mod
├── internal/{config,logger,version}/...
├── daemon.log
└── .orquesta/...
```

`.orquesta/crew/worktrees/` is **empty** — no worktree was ever created.

The coder itself flagged this in its `report_complete` summary:

> Note: the worktree had no .git directory, so no commit was made; all source files were written at the project root /private/tmp/orq-issue-test-1777514001/.

The downstream tester then reports:

> No tests run: the worktree contains no coder output

…because it's diffing `git diff base..HEAD` in a non-repo, which returns nothing.

## Root cause

`src/daemon/task-pipeline.ts:143`:

```ts
if (this.config.git?.enabled && ensureRepoReady(this.store.root, this.config.git.baseBranch)) {
  const workspace = createTaskWorktree(...);
  current = { ...current, worktree_path: workspace.worktreePath, ... };
}
```

When the guard fails (no git, no baseBranch, no `.git/`), `task.worktree_path` stays `undefined` and the pipeline keeps going. There is **no warning, no error, no abort**.

Downstream side effects:

1. `seedSession()` plants `.orq/<sub-id>/` in the daemon CWD, alongside source files.
2. The agent's CLAUDE.md (templates/) tells it: *"You are working inside a dedicated git worktree for this task."* — false.
3. `coderProducedChanges` short-circuits to `true` when `worktree_path` is undefined (`src/daemon/task-pipeline.ts:158-161`), so the "no diff" early-exit path never fires.
4. Tester / critic prompts use `safeGitOutput(task.worktree_path, ...)` which returns `""`. The tester then has nothing to test.
5. Concurrent tasks would race in the same CWD if `concurrency.workers > 1` (default is 2).

## Expected behavior

One of:

- **Refuse to start** if `git.enabled === true` and the root is not a usable repo, with a clear error: `daemon root is not a git repository; run \`git init && git commit --allow-empty -m init\` or set \`git.enabled = false\` in .orquesta/crew/config.json`.
- **Auto-init** an empty repo + `main` branch on first start (and document it).
- If the user explicitly opts out of git, fall back to per-task subdirectories under `.orquesta/crew/worktrees/<runId>/<taskId>/` and use those as the agent CWD — even without git.

A silent fallback to the shared CWD is unacceptable: it produces broken testing, unsafe parallelism, and misleading agent prompts.

## Affected files

- `src/daemon/task-pipeline.ts:143-158` (worktree provisioning + change detection)
- `src/daemon/task-closure.ts:87` (closure also depends on git)
- `src/core/git.ts:35-40` (`ensureRepoReady`)
- `templates/CLAUDE.md` (assumes worktree always exists)
- `scripts/test-daemon-flow.sh` (does not `git init` the target dir)

## Acceptance criteria

- [ ] Starting the daemon in a non-git dir with `git.enabled=true` produces an actionable error before the planner runs.
- [ ] OR the test script `git init`s the target and commits an empty initial commit.
- [ ] When isolation is disabled, the role prompts (CLAUDE.md / GEMINI.md / AGENTS.md) reflect that fact.
- [ ] Tester does not falsely claim "no coder output" when there are clearly new files on disk.
