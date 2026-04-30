# PRD 0001 — TUI fix + planner UI strip + import shim

Date: 2026-04-30
Branch: `daemon-ui-refactor`
Status: `needs-triage`
Related ADRs: [`docs/adr/0001-defer-planner-removal.md`](../../docs/adr/0001-defer-planner-removal.md), [`docs/adr/0002-tui-information-architecture.md`](../../docs/adr/0002-tui-information-architecture.md)
Domain glossary: [`CONTEXT.md`](../../CONTEXT.md)

## Problem Statement

The Go TUI is not usable for inspecting orq Runs. Concretely:

- The list view silently truncates anything past the bottom of the
  pane — Tasks, Agents, or both disappear depending on terminal size.
  Users see only the upper part of a Run and cannot scroll.
- The right pane is empty unless the user presses `enter`, and even
  then it only attaches a *live* PTY. There is no way to inspect a dead
  agent: no structured info, no PTY scrollback, no way to re-open the
  CLI's own session.
- The TUI exposes a tiny fraction of what the Web UI provides — no
  iteration navigation, no activity feed, no chat, no resume action,
  no ask toast. Users who want to do anything beyond eyeballing the
  list are forced into the browser.
- Separately, the human-prompted Planner phase no longer fits the
  intended Day-mode / Night-mode workflow (see `CONTEXT.md`). Building
  the initial Task DAG belongs in day mode (human + interactive
  LLMs); the orq daemon should execute pre-built DAGs and iterate
  AFK. The current `PlanPrompt` / "Approve & Start" UI prompts the
  user to do day-mode work *inside* night-mode tooling.

## Solution

Bring the TUI to feature parity with the Web UI under a TUI-native
layout, and remove the planner-mode UI from both surfaces so the
project visibly commits to the Day-mode / Night-mode split. The daemon
side keeps the PlannerService for now (per ADR 0001) — only the UI
surfaces change. A minimal task-ingestion shim (`orq import` /
`POST /api/tasks/import`) gives the user a way to start a Run without
the planner.

The TUI follows ADR 0002: a persistent two-column layout with a
cursor-driven Activity feed, an `enter`-flips-to-Agent-Detail mode for
the right pane, a one-key `R` resume that uses the daemon's already
implemented session-resume, an iteration navigator, a `/` chat
overlay, and an empty-state placeholder pointing the user at
`orq import`.

## User Stories

1. As a developer running orq, I want the TUI to never silently clip
   the Tasks or Agents list, so that I can trust what I see is the
   complete state.
2. As a developer running orq, I want to scroll the Tasks/Agents list
   with `j/k`, page up/down, and home/end keys, so that I can navigate
   long Runs from the keyboard.
3. As a developer running orq, I want the cursor to stay visible
   inside the viewport as I move it, so that I never lose track of my
   selection.
4. As a developer inspecting a finished Run, I want to put the cursor
   on a dead agent and immediately see its structured info (role, CLI,
   model, status, exit code, stop reason, durations, costs, bound
   task and subtask, captured CLI session id, worktree path), so that
   I can understand what the agent did without having to attach.
5. As a developer inspecting a finished Run, I want to press `enter`
   on a dead agent and see the PTY scrollback the daemon already
   cached (replay), so that I can read its terminal output even
   though the process has exited.
6. As a developer recovering from a stuck or failed agent, I want to
   press `R` on a dead resumable agent and have orq re-launch the
   underlying CLI's own session (`claude --resume <id>`,
   `codex resume <id>`) inside the original worktree, so that I can
   pick up the conversation and finish the work manually.
7. As a developer, I want to see at a glance whether an agent is
   resumable (capture status of `cli_session_id` and presence of the
   worktree), so that I know which agents `R` will work on.
8. As a developer, I want a single right-pane Activity feed that is
   automatically filtered by what my cursor is on (a task, an agent,
   or nothing — meaning current iteration), so that I can read the
   journal without juggling filter controls.
9. As a developer monitoring a live Run, I want to navigate between
   iterations with `[` and `]`, so that I can review what each
   iteration boundary produced.
10. As a developer monitoring a live Run, I want the visible iteration
    to apply globally (Tasks list, Activity feed both filter to it),
    so that I never see a mismatch between what's shown on the left
    and what's shown on the right.
11. As a developer, I want to send a chat message to the
    currently-selected agent via a `/`-triggered overlay, so that I
    can answer questions or steer agents without leaving the TUI.
12. As a developer, I want an ephemeral toast in the corner when an
    agent raises an ask, so that I am not silently blocked on a
    pending question.
13. As a developer, I want the toast to let me jump to that agent
    with `enter`, so that I can answer the ask quickly.
14. As a developer who pinned an agent, I want that pin to persist
    across iteration changes within the session, so that I can keep
    watching a long-running coder while iterations cycle.
15. As a developer running orq for the first time after the planner
    UI is removed, I want a clear empty state telling me to run
    `orq import <file>`, so that I am not confused by a blank screen.
16. As a developer who used to type "build me X" into PlanPrompt, I
    want to instead build my Task DAG in day mode (using grilling and
    PRD skills with claude/codex/gemini) and then hand the resulting
    DAG file to the daemon, so that night-mode execution starts with
    a vetted, human-reviewed plan.
17. As a developer with a JSON file describing a Run, I want to
    `orq import path/to/run.json` and have the daemon set up a Run
    with that exact DAG marked `approved`, so that the orchestrator
    starts iterating without needing the planner agent.
18. As a developer using the HTTP API directly, I want a
    `POST /api/tasks/import` endpoint that accepts the same DAG
    payload (token-gated like every other mutating route), so that
    automated tooling can seed Runs.
19. As a developer who imports a malformed DAG, I want the import
    to be rejected with a clear error (cycle detected, missing
    dependency, bad role, schema mismatch) and no partial state
    written, so that I can fix the file and try again.
20. As a developer running `orq doctor`, I want it to confirm that
    imported runs are supported and report whether a current Run was
    seeded by import or by the planner, so that I can verify the
    new path is wired up.
21. As a developer using the Web UI alongside the TUI, I want the
    Web UI to no longer show PlanPrompt or planner-mode 3-column
    layout, so that both UIs converge on the same Day-mode /
    Night-mode model.
22. As a developer using the Web UI, I want the empty state to
    show the same "run `orq import`" placeholder the TUI shows, so
    that the message is consistent across surfaces.
23. As a developer reading the Web UI's run banner, I do not want
    to see "Approve & Start" prompts, so that I am not invited to
    do day-mode work inside night-mode tooling.
24. As a maintainer, I want validators (architect/pm/qa) and the
    iteration-boundary auto-improvement loop to keep working
    unchanged, so that night-mode auto-correction is preserved.
25. As a maintainer, I want the daemon's `PlannerService`,
    `/api/plan`, and `/api/approve` to remain functional but
    unreachable from the UIs, so that we have a fallback while plan
    #2 (day-mode integration) lands.
26. As a developer with a narrow terminal (<80 columns), I want the
    TUI to fall back to a vertical stack with sensible default
    weights, so that the interface remains usable.
27. As a developer, I want a context-sensitive footer that shows the
    keymap relevant to my current mode, so that I do not have to
    memorise every key.
28. As a developer, I want a `?` key that shows full keymap help, so
    that I can discover keys I do not use often.
29. As a developer, I want the resumed PTY to live alongside the
    original agent in the daemon, so that the original agent's
    record (exit code, costs, captured session id) is preserved for
    historical inspection even after I resume.
30. As a developer who tries to resume a Gemini-driven agent, I want
    a clear "resume not supported for gemini" message instead of a
    cryptic failure, so that I know it is a CLI limitation, not a
    bug.
31. As a developer who tries to resume an agent whose worktree was
    cleaned up, I want a clear "worktree no longer exists" error
    with the path, so that I can decide whether to recreate it
    manually.

## Implementation Decisions

### Domain & ADRs

- Day-mode / Night-mode split adopted (`CONTEXT.md`).
- Planner removal deferred to plan #2; this PRD strips UI only and
  adds the import shim (ADR 0001).
- TUI IA: persistent two-column layout, cursor-driven activity,
  `enter`-flips right pane to Agent Detail (ADR 0002).
- Validators (architect/pm/qa) and the agreement-to-stop iteration
  termination remain unchanged. The behaviour already exists in the
  iteration manager.

### Modules

#### TUI (Go, `tui/internal/`)

- **`ui/viewport`** *(new, deep)* — pure scroll viewport. Owns
  cursor position, scroll offset, content slice rendering. Drives
  the Tasks+Agents list and the Activity feed.
- **`ui/right_pane`** *(new, deep)* — explicit state machine with
  modes `Activity | AgentDetail | LivePTY | ReplayPTY | ResumedPTY`
  and legal transitions on `enter`, `R`, `esc`. PTY I/O delegated
  to existing `client.OpenTTY`.
- **`ui/list`** *(rewrite)* — Tasks + Agents combined, single
  cursor crossing groups, iteration-filtered Tasks. Uses
  `viewport`.
- **`ui/activity`** *(new)* — cursor-filtered event feed, uses
  `viewport`. Subscribes to the daemon's existing event stream.
- **`ui/agent_detail`** *(new)* — structured info card (the (c)
  view). Read-only render of an `Agent` plus computed derivations
  (resumable yes/no, worktree exists yes/no).
- **`ui/header`** *(new)* — Run id, iteration nav (`[`/`]`),
  status. Replicates Web's `Shell` + `IterationNav`.
- **`ui/footer`** *(new)* — context-sensitive keymap.
- **`ui/chat`** *(new)* — `/` overlay composer; targets selected
  agent (or planner-agent if any exists; otherwise disabled).
- **`ui/toast`** *(new)* — top-right ephemeral ask notifications.
- **`ui/empty`** *(new)* — "run `orq import` …" full-screen
  placeholder when no Run exists.
- **`ui/home`** *(rewrite)* — top-level Bubble Tea model wiring all
  the above.
- **`client`** *(extend)* — `PostResume(agentID)`, an Activity
  events accessor (replay + live), cleaner `RunState` typing for
  iteration-scoped queries.

#### Web UI (TypeScript/React, `src/ui/`)

- `components/PlanPrompt.tsx` — **delete**.
- `components/EmptyState.tsx` — **new**. Static "run `orq import`"
  panel.
- `App.tsx`, `hooks/useRunState.ts` — **modify**. Collapse `mode`
  from `empty | planner | run` to `empty | run`. Remove planner
  state and the planner-mode 3-column branch. The "Approve &
  Start" banner is removed — Runs land already `approved` via the
  import shim.
- `components/Shell.tsx` — minor cleanup if it carries
  planner-only strings.

#### Daemon (TypeScript, `src/daemon/`, `src/api/`, `src/cli/`)

- **`daemon/task-import.ts`** *(new, deep)* — single-purpose
  module. Validates the imported payload via Zod. Runs cycle and
  dependency checks reusing `core/dag`. Atomically writes a fresh
  `Plan` (status `approved`, `current_iteration: 1`,
  `max_iterations: <provided>`), the supplied `Task[]`, and an
  iteration-1 row. Refuses if a Run is currently `running`.
  Replaces the `PlannerService.startPlanner` codepath for imported
  Runs.
- **`api/http.ts`** *(extend)* — `POST /api/tasks/import`. Added to
  `mutatingRoutes`, token-gated. Body size capped (per existing
  convention). Returns `{ ok: true, runId }` or
  `{ ok: false, error: { code, message } }`.
- **`cli/orq.ts`** *(extend)* — new `orq import <file>` subcommand
  that POSTs the file (or runs the import in-process if no daemon
  is reachable, mirroring `orq plan`). New `orq doctor` line
  reporting "imported-run support: ok".

### Schema for the imported DAG

Reuses existing types. Approximate shape:

```
{
  prompt?: string,        // free-form description, stored on Plan.prompt
  max_iterations: number, // default 2 if absent
  tasks: Task[]           // same Zod schema currently used by emit_tasks
}
```

`runId` is generated server-side. Subtasks are created lazily by the
orchestrator's existing pipeline, so the import only needs Tasks.

### API contract

- `POST /api/tasks/import` — body `application/json`, capped at the
  same body size as other mutating routes. Token-gated. Errors:
  `400 invalid_payload`, `409 run_in_progress`, `422 dag_cycle`,
  `422 missing_dependency`.

### Interactions

- TUI `enter` on agent → right pane mode `AgentDetail`. PTY (replay
  if dead, live if alive) renders below the info card.
- TUI `R` on resumable dead agent → `POST /api/agents/:id/resume`
  → on success, right pane mode `ResumedPTY`, attached to the new
  resume session via existing `/tty/:id:resume` WebSocket.
- TUI `esc` → right pane back to `Activity`.
- TUI `[` / `]` → adjusts current iteration filter; both Tasks and
  Activity reflect it.
- TUI `/` → opens chat overlay; targets cursor-selected agent.
- TUI `?` → full keymap help overlay.
- Web UI: planner-mode branches removed; empty mode shows the new
  EmptyState; run mode unchanged.

## Testing Decisions

A good test here exercises external behaviour, not implementation
details. For TUI Bubble Tea models we test the model's `Update` /
`View` outputs given input messages, not the rendered string verbatim
(string-rendered tests rot fast). For the daemon we test HTTP
contracts and store side-effects, not internal call graphs.

### Modules to test

1. **`tui/internal/ui/viewport`** — pure module, comprehensive unit
   tests:
   - cursor moves within bounds
   - cursor at end of content does not exceed last index
   - scroll offset updates to keep cursor visible
   - page-up / page-down respect content length
   - `g` / `G` jump to top/bottom
   - content shorter than height: no scrolling, full content
     visible
2. **`tui/internal/ui/right_pane`** — state machine tests:
   - every legal transition (`Activity → AgentDetail → LivePTY`,
     `AgentDetail → ResumedPTY`, all back to `Activity` via `esc`)
   - illegal transitions are rejected (no resume from non-agent
     selection, no live PTY for a dead agent without `enter`)
   - `R` is disabled when `cli_session_id` absent
   - `R` is disabled for `cli == "gemini"`
3. **`src/daemon/task-import.ts`** (new TS test):
   - happy path: valid DAG → Plan + Tasks + iteration 1 written,
     status `approved`
   - cycle detection
   - missing-dependency rejection
   - run-in-progress rejection (no partial writes)
   - re-import while previous Run is `done` overwrites cleanly
4. **`POST /api/tasks/import`** (extend `src/test/http.test.ts`
   patterns):
   - token gate: 401 without token, 200 with token
   - error shapes consistent with existing routes
   - body size cap honoured

### Modules deliberately not unit-tested

- TUI `header`, `footer`, `empty`, `toast`, `chat` overlay — visual
  chrome with little logic. Covered transitively by an end-to-end
  TUI smoke test if/when we add one.
- TUI `agent_detail` — render of static struct fields; covered by
  `right_pane` mode tests via View output assertions.
- TUI `client` extensions — covered transitively by an HTTP
  contract test on the daemon side; mocking Go HTTP for unit tests
  has a low return on investment here.
- Web UI strip — existing UI tests should be updated where they
  reference `PlanPrompt` or `mode === "planner"`. No new UI tests
  added.
- `orq import` CLI subcommand — covered transitively by the HTTP
  test plus an existing `orq plan` shape we can mirror.

### Prior art

- TUI Go tests: none yet — this PRD introduces the first ones, with
  `viewport` as the simplest deep module to start the pattern.
- Daemon TS tests: `src/test/http.test.ts`, `src/test/http.cancel.test.ts`,
  `src/test/http.planner.test.ts` — similar HTTP route shape.
- DAG validation: `src/test/dag.test.ts` — reuse helpers for cycle
  cases.

## Out of Scope

- Task ingestion design beyond the minimal shim (file watch, Linear
  / GitHub issue ingest, day-mode skills wiring) — that is plan #2.
- Removing `PlannerService`, `/api/plan`, `/api/approve`,
  `awaiting_approval`, the `planner` role, or the planner argv
  adapters — deferred per ADR 0001.
- Changing how validators (architect/pm/qa) run at iteration
  boundaries (concurrent execution, separate proposal storage) —
  flagged in `improvement_plan_v1.md` Phase 3.
- Changing the per-task pipeline (coder → tester → critic → fix).
- Daemon restart recovery — Phase 3 of the improvement plan.
- Persisting full PTY transcripts to disk for arbitrarily-long
  replay — current 200 KB in-memory cache is reused as-is.
- Gemini resume support — blocked by upstream CLI not having
  resume-by-stable-id.
- TUI mouse support, theming, dynamic colour selection.
- Browser tests for the new EmptyState — out of scope; a manual
  acceptance check is enough.

## Further Notes

- The Web UI's resume button (`TerminalDrawer.tsx`) and the
  daemon's `POST /api/agents/:id/resume` already work. The TUI
  side just needs to call them. This is the single largest free
  win in the plan — *no* backend work for resume.
- `iteration-manager.ts:142-148` already implements
  agreement-to-stop. No daemon change needed for the iteration
  semantics described in the user stories.
- The "history of tasks being cut" symptom in the original report
  is the silent `rows[:height]` slice in `tui/internal/ui/list.go`.
  The viewport module fixes it for both list and activity.
- Plan #2 (day-mode integration) is a hard prerequisite for
  removing the daemon planner. This PRD must land before plan #2
  starts so that the UI surfaces are clean and the import shim
  exists for plan #2 to integrate against.
- Acceptance smoke: with this PRD shipped, a developer should be
  able to run `orq import sample.json && orq start`, watch a
  multi-iteration Run end-to-end in the TUI, attach to a live
  agent, navigate between iterations, see a dead agent's structured
  info, replay its PTY, resume its CLI session, and answer an ask
  via toast — without ever touching the browser.
