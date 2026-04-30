# [P1] Tester / critic prompts rely on `git diff base..HEAD` and produce empty work in non-git roots

**Labels:** `bug`, `priority:high`, `agents`, `prompts`

## Summary

The tester and critic prompts are constructed from `safeGitOutput(task.worktree_path, ["diff", …, base..HEAD])`. When there is no worktree (see issue 001), or when the coder did not commit (see related), these calls return empty strings. The agents then receive a prompt that lists no files and no diff, and they faithfully report "nothing to test" / "nothing to review" — even when there is a fully populated source tree on disk.

## Reproduction

In our smoke run the coder created `go.mod`, `cmd/server/main.go`, `internal/config/*`, `internal/logger/*`, `internal/version/*`, `Makefile`, etc. directly in `/tmp/orq-<id>/`. The tester then reported:

> No tests run: the worktree contains no coder output

…and the run still moved on as if everything were fine. Task-1 was marked `done` after a critic that also had nothing to review.

## Root cause

`src/daemon/task-pipeline.ts:27-32`:

```ts
if ((role === "tester" || role === "critic") && task.worktree_path && task.base_branch) {
  const stat = safeGitOutput(task.worktree_path, ["diff", "--stat", `${task.base_branch}..HEAD`]).trim();
  const body = safeGitOutput(task.worktree_path, ["diff", `${task.base_branch}..HEAD`]);
  …
}
```

The diff-based scoping logic has two assumptions that aren't enforced:

1. `task.worktree_path` and `task.base_branch` exist (they don't if git is disabled or the root is not a repo — issue 001).
2. The coder committed its changes. The coder *did* attempt to commit, but `git commit` fails silently when there is no `.git/` directory; the coder's summary explicitly says "no commit was made".

When either assumption is violated, the prompt body is empty and the tester/critic have nothing to work with — but the pipeline still treats their `report_complete` as authoritative.

## Expected behavior

If the diff cannot be reconstructed (no worktree, no commit, no base branch), the pipeline should:

- **Refuse** to start the tester/critic and abort the task with a clear error, OR
- **Fall back** to a non-git scope description: list files modified since the coder started by stat'ing the directory tree, and pass those paths to the tester/critic.

Silent "no diff" → "tester says everything is fine" is the worst possible failure mode, because it fakes a green run.

## Affected files

- `src/daemon/task-pipeline.ts:18-44` (`buildScopedPrompt`)
- `src/agents/seed.ts` (where role prompts are seeded)

## Acceptance criteria

- [ ] When no diff can be derived, the tester/critic either abort or receive a non-git scoped prompt.
- [ ] If they receive an empty scope and complete with "nothing to test", the task is **not** marked `done`.

## Related

- Issue 001 (no worktree when target is not a git repo)
