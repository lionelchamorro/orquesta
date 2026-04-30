# [P2] `/api/diagnostics` reports `git.repo: false` but the daemon still starts in unsafe mode

**Labels:** `bug`, `priority:medium`, `daemon`, `safety`, `dx`

## Summary

The diagnostics endpoint correctly detects that the daemon's CWD is not a git repository:

```json
$ curl -s :8011/api/diagnostics | jq .git
{
  "available": true,
  "repo": false,
  "branch": "",
  "dirty": false
}
```

…yet the daemon happily accepts a plan, spawns a planner, and runs the full pipeline anyway — silently degrading to no-isolation mode (issue 001) and producing fake-green test results (issue 009).

## Reproduction

```bash
ORQ_PORT=8011 ORQ_TEST_DIR=/tmp/orq-no-git \
  bash scripts/test-daemon-flow.sh
# scripts/test-daemon-flow.sh's target dir is never git-init'd
```

The diagnostics endpoint shows `repo: false`, but the planner runs and tasks execute.

## Expected behavior

When `git.enabled === true` (default) **and** `diagnostics.git.repo === false`:

- Daemon startup should print a prominent warning to stderr.
- `/api/health` should report `degraded` (not `ready`) with a reason.
- `POST /api/plan` should refuse with HTTP 412 ("Precondition Failed: daemon root is not a git repository") unless an explicit `force=true` query param is set.

This is a defense-in-depth measure on top of issue 001's primary fix.

## Affected files

- `src/daemon/index.ts` (startup-time gating)
- `src/api/http.ts:88` (`/api/health`)
- `src/api/http.ts:91` (`/api/diagnostics`)
- `src/api/http.ts:252` (`POST /api/plan`)

## Acceptance criteria

- [ ] Daemon either refuses to accept a plan in a non-repo, or surfaces a `degraded` health state.
- [ ] Health probe used by the test script can detect the degraded state without changes (i.e., the script-side `curl /api/health` already fails).
