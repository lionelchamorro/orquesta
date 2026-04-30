# Orquesta — Architecture & Technical Reference

A complete description of how Orquesta is structured and how every subsystem works.

> Scope: this document covers the **`daemon-ui-refactor`** branch as of April 2026. It is intended for engineers reading or extending the codebase. Code paths use the form `src/...:N` so you can jump to a specific line.

---

## 1. What Orquesta Is

Orquesta is a **multi-agent orchestration daemon** for software engineering work. A user supplies a prompt; the system:

1. Spawns a **planner** agent that produces a DAG of tasks.
2. After human (or autonomous) approval, drives the DAG through **waves** of execution.
3. For every task, runs a deterministic **code → test → critic → fix-loop** pipeline inside an isolated **git worktree**.
4. Between waves, runs a validator triple (**architect / pm / qa**) that may emit refinement tasks for the next iteration.
5. Streams everything — agent stdout, lifecycle events, tool calls — to a React dashboard over WebSocket and exposes a REST API + a Model Context Protocol (MCP) endpoint that agents themselves call back into.

The system is opinionated: a single Bun process owns all state; agents live in PTYs spawned by `Bun.spawn`; durable state is plain JSON under `.orquesta/crew/`; an SQLite journal records every bus event.

### 1.1 Stack

| Layer | Technology |
|---|---|
| Runtime | **Bun** ≥ 1.3.5 (HTTP server, PTYs, SQLite, daemon process) |
| Language | TypeScript (strict) for the daemon and Web UI; Go (≥ 1.22) for the optional TUI |
| Validation | Zod |
| Web UI | React 18 + Vite (build & dev) + xterm.js |
| TUI | Go + Bubble Tea + Lipgloss + gorilla/websocket (`tui/`) |
| Terminal emulation | `Bun.Terminal` (PTY) + `@xterm/headless` (server-side render for snapshots) |
| Persistence | Atomic JSON files + `bun:sqlite` event journal |
| Inter-agent protocol | Model Context Protocol (JSON-RPC 2.0 over HTTP), session-token auth |
| Supported CLIs | `claude`, `codex`, `gemini` (each spawned as a child process) |

### 1.2 Repository Layout

```
src/
  agents/           Agent process pool, PTY wrapper, per-CLI adapters, session seeding
  api/              HTTP handler + WebSocket upgrades
  bus/              In-process pub/sub + SQLite journal
  cli/              `orq` command-line entry
  core/             Pure types, Zod schemas, DAG utilities, plan store, git wrapper, session token
  daemon/           Orchestrator, task pipeline, iteration manager, ask-router, planner-service
  mcp/              MCP server + tool registry
  ui/               React dashboard (main.tsx + components + xterm WebTTY)
  ui-server/        Standalone Bun process that serves the prebuilt React bundle on its own port
  test/             Bun test suite (~21 files)
tui/                Go (Bubble Tea) terminal client — talks to the daemon over REST + /events + /tty
  internal/client/    HTTP/WS client (run state, /api/* mutations, TTY attach)
  internal/ui/        TUI views (home / list / preview)
templates/          Role markdown templates + MCP config templates
scripts/            `dev.sh` (daemon + Vite together), test runners
dist/               Build output: dist/daemon, dist/ui, dist/orq-tui
.orquesta/crew/     All durable state (created at runtime; not committed)
```

---

## 2. Conceptual Model

### 2.1 Domain Entities

These are defined in `src/core/types.ts` and validated in `src/core/schemas.ts`.

| Entity | Purpose | Persisted at |
|---|---|---|
| `Plan` | A single run. Tracks status, iteration counter, task counters. | `crew/plan.json` |
| `Config` | Team composition, concurrency, retries, git options. | `crew/config.json` |
| `Task` | One node of the DAG. Owns a worktree and 1..N subtasks. | `crew/tasks/<id>.json` |
| `Subtask` | One execution slot inside a task: `code`, `test`, `critic`, `fix`. | `crew/subtasks/<taskId>/<id>.json` |
| `Iteration` | A wave boundary. Records which tasks were proposed for it. | `crew/iterations/<id>.json` |
| `Agent` | One spawned CLI process; bound 1:1 to a subtask (or planner). | `crew/agents/<id>.json` |
| `PendingAsk` | A blocked `ask_user` MCP call awaiting an answer. | `crew/asks/<id>.json` |

### 2.2 Status Enums

- `PlanStatus`: `drafting → awaiting_approval → approved → running → done | failed`
- `TaskStatus`: `pending → ready → running → done | failed | blocked | cancelled`
- `SubtaskStatus`: same enum as `TaskStatus`
- `AgentStatus`: `idle | working | live | dead`
- `IterationTrigger`: `initial | architect_replan | qa_regression`
- `SubtaskType`: `code | test | critic | fix | custom`
- `Role`: `planner | coder | tester | critic | architect | pm | qa`

State transitions are enforced by `PlanStore.transitionTask` / `transitionSubtask` against an allow-list (`taskTransitions`); invalid transitions throw.

### 2.3 The Three Phases of a Run

```
                ┌──────────── PLANNING ───────────┐
   user prompt ─▶│ planner agent → emit_tasks DAG │──▶ awaiting_approval
                └────────────────────────────────┘
                              │ approve
                              ▼
                ┌──────────── EXECUTION ──────────┐
                │ Orchestrator wave loop          │
                │  ├─ readySet(DAG)               │
                │  ├─ TaskPipeline.run() per task │
                │  │    ├─ coder subtask          │
                │  │    ├─ tester subtask         │
                │  │    ├─ critic subtask         │
                │  │    └─ fix loop (≤ N attempts)│
                │  └─ closeTask: merge + archive  │
                └─────────────────────────────────┘
                              │ wave empty
                              ▼
                ┌──────────── ITERATION BOUNDARY ─┐
                │ IterationManager.onWaveEmpty()  │
                │   either → run_completed        │
                │   or     → architect/pm/qa      │
                │             emit refinement tasks│
                └─────────────────────────────────┘
                              │ new tasks ready
                              └────► (next wave)
```

---

## 3. The Daemon

`src/daemon/index.ts` is the single Bun entry point. It wires every long-lived component and starts the HTTP server.

### 3.1 Boot Sequence

```ts
const store        = new PlanStore(root);
const sessionToken = await getOrCreateSessionToken(store);
const journal      = new Journal(store.crewPath("journal.sqlite"));
const bus          = new Bus({ journal });
const pool         = new AgentPool(root, store, bus, { mcpPort: port, templatesDir, mcpToken: sessionToken });
const askRouter    = new AskRouter(store, pool, bus, { autonomous });
const config       = await store.loadConfig();
ensureRepoReady(root, config.git?.baseBranch ?? "main");   // logs degraded state if no git repo
const recovered    = await store.recoverInterruptedRun();
const pipeline     = new TaskPipeline(store, bus, pool, config);
const iterations   = new IterationManager(store, pool, bus, config);
const orchestrator = new Orchestrator(store, pipeline, iterations, config);
const plannerSvc   = new PlannerService(store, pool, { mcpPort: port, bus, autonomous });
const mcpHandler   = createMcpHandler({ store, bus, askRouter, agentPool: pool, sessionToken });
const httpHandler  = createHttpHandler({ root: packageRoot, store, pool, bus, askRouter, mcpHandler,
                                          plannerService, uiBuildDir, sessionToken, journal,
                                          corsOrigin: Bun.env.ORQ_CORS_ORIGIN });
const wsHandlers   = createWebSocketHandlers(bus, pool, journal, { sessionToken, corsOrigin });
```

The daemon does **not** bundle the UI itself. It serves a **prebuilt React bundle** from `dist/ui/` (produced by `bun run build:ui`, which runs `vite build`). If the build dir is missing, the daemon falls back to streaming `src/ui/index.html` directly (useful only when running through Vite's dev server). The server listens on `ORQ_HOST` (default `127.0.0.1`) and `ORQ_PORT` (default `8000`).

When `ORQ_CORS_ORIGIN` is set, the HTTP handler emits CORS headers and the WebSocket upgrade accepts that origin in addition to same-host. This is what enables the **separated-deploy mode** (daemon on one port, the standalone `ui-server` on another, optionally on a different host) and the Go TUI running outside the browser.

`recoverInterruptedRun()` is critical: every time the daemon starts, it scans for `running` tasks/subtasks and `live` agents (the previous process did not exit cleanly), and demotes them to `pending`/`failed`/`dead` so the orchestrator can resume.

### 3.2 Environment Knobs

| Env var | Default | Effect |
|---|---|---|
| `ORQ_PORT` | `8000` | Daemon HTTP/WS port. |
| `ORQ_HOST` | `127.0.0.1` | Daemon bind address. |
| `ORQ_CORS_ORIGIN` | _unset_ | If set, enables CORS for that origin and accepts WebSocket upgrades from it (separated UI / TUI). |
| `ORQ_UI_PORT` | `4173` | Port for the standalone `ui-server` (`src/ui-server/index.ts`). |
| `VITE_DAEMON_URL` | `http://localhost:8000` | Where the prebuilt UI should send REST/WS traffic when served by `ui-server` on a different origin. |
| `ORQ_DAEMON_URL` | `http://localhost:8000` | Daemon URL the Go TUI dials. |
| `ORQ_CWD` | _PWD_ | Working directory the daemon should manage when launched via `scripts/dev.sh`. |
| `ORQ_AUTONOMOUS` | `false` | Auto-approve plan, auto-answer asks after first timeout, no human gating. |
| `ORQ_SUBTASK_TIMEOUT_MS` | `300000` | Per-subtask wall clock limit. |
| `ORQ_ROLE_TIMEOUT_MS` | `300000` | Per-validator (architect/pm/qa) wall clock limit. |
| `ORQ_PLANNER_TIMEOUT_MS` | `300000` | Planner wall clock limit. |
| `ORQ_INITIAL_PROMPT_DELAY_MS` | `1200` | Wait before sending first keystroke after spawn (TUI ready). |
| `ORQ_INITIAL_PROMPT_SUBMIT_DELAY_MS` | `250` | Delay between text and Enter. |

### 3.3 The Orchestrator (`src/daemon/orchestrator.ts`)

A 500 ms tick loop that is the only place tasks are dispatched. Each tick:

1. Loads plan; bails unless status is `approved` or `running`. On first tick, transitions `approved → running`.
2. If `IterationManager.isRunning()`, bails (mutex).
3. Computes `blockedByFailedDeps(tasks)` and writes `status = blocked, closure_reason = blocked_by_dep` for any unrecoverable nodes.
4. Computes `readySet(tasks)`; while there is room (`running.size < config.concurrency.workers`) and ready work, pops a task, marks it in-flight, and fires `pipeline.run(next)` without awaiting. The `.finally()` removes it from `running`.
5. If no tasks are running and every task is terminal, calls `iterations.onWaveEmpty()`.
6. After `config.work.maxWaves` dispatches, sets `stopped = true` (a hard safety brake).

Concurrency is bounded by `config.concurrency.workers` (default 2). The `running` Set guarantees a single task is never pipelined twice at the same time.

### 3.4 The Task Pipeline (`src/daemon/task-pipeline.ts`)

Owns one task end-to-end. The flow:

1. `incrementTaskAttempt`, `transitionTask → running`.
2. **Worktree creation** (if `config.git.enabled`): `createTaskWorktree(root, taskId, baseBranch, runId)` makes `.orquesta/crew/worktrees/<runId>/<taskId>` on a branch `orq/<runId>/<taskId>`. Patches `worktree_path`, `branch`, `base_branch` onto the task.
3. **Coder subtask**: spawns a `coder` agent in the worktree. `buildScopedPrompt` injects the worktree path and the warning that `.orq/<sub-id>` is just the MCP session dir, *not* the working tree.
4. **No-op detection**: after the coder exits, runs `git diff --name-only` and `hasUncommittedChanges`. If both are empty, sets `closureReason = no_changes` and exits the loop.
5. **Tester subtask**: depends on the coder; injected with `git diff --stat` and the diff body (truncated at `DIFF_BODY_CHAR_MAX = 30000`).
6. **Critic subtask**: depends on the tester; same diff injection.
7. **Fix loop**: while `attempt < config.work.maxAttemptsPerTask`:
   - Drain pending `fix` subtasks the critic emitted via `request_review_subtask`.
   - For each, spawn a coder agent sequentially; then re-run the tester and critic.
   - Break when the critic returns no findings, or `max_attempts` is hit.
8. **Always** call `closeTask(...)` in `finally`.

`waitForSubtask` listens on the bus for `subtask_completed | subtask_failed`, races the agent's exit promise (`pool.waitForExit`), and a `ORQ_SUBTASK_TIMEOUT_MS` timer.

Closure reasons emitted by the pipeline: `critic_ok`, `no_changes`, `max_attempts`, `failed_subtask`. The closure layer can downgrade these (see §3.5).

### 3.5 Task Closure (`src/daemon/task-closure.ts`)

Single function `closeTask(deps, taskId, closureReason)` that runs irrespective of how the task ended:

1. Loads task, subtasks, and the agent records bound to them.
2. Kills any non-dead agents and waits ≤ 5 s for exit.
3. Decides `shouldMerge = gitEnabled && worktreePresent && closureReason ∈ {critic_ok, max_attempts}`.
4. If merging:
   - Runs `autoCommitAll(worktreePath, message)` unless `config.git.autoCommit === false`.
   - Runs `mergeBranch(root, branch, baseBranch, title)` (a `--no-ff` merge into the base branch).
   - If post-commit there is nothing to merge, downgrades to `no_changes`.
   - On merge failure, sets `effectiveClosure = merge_conflict` and records `task.merge_error`.
5. **Debug preservation**: for `merge_conflict` and `failed_subtask`, the worktree is **kept** so a human can inspect it. Otherwise:
   - Each agent's session dir is moved (atomic `rename`) to `crew/archive/<runId>/<taskId>/<role>-<agentId>/`.
   - The worktree is removed (only if the `.orquesta-worktree` marker confirms ownership).
6. Final task status: `failed` for `merge_conflict | failed_subtask`, `done` otherwise.
7. Writes a markdown summary to `crew/tasks/<taskId>.md`.
8. Publishes `task_merged` and/or `task_archived` on the bus.

### 3.6 Iteration Manager (`src/daemon/iteration-manager.ts`)

Driven by `Orchestrator.tick()` when a wave empties.

- If `plan.current_iteration >= plan.max_iterations`, computes the final run status (all tasks `done` → `done`, else `failed`), publishes `run_completed`, returns.
- Otherwise:
  - Creates an `Iteration` record with `trigger = "architect_replan"`. The summary is one line per task: `<id>: <summary|title>`.
  - Bumps `plan.current_iteration`.
  - **Sequentially** spawns the validators present in `config.team`: `architect`, then `pm`, then `qa`. Each is given a list of tasks already proposed for the new iteration so it does not duplicate work.
  - Waits for `agent_completed` or the role timeout for each.
  - If after all three no tasks for the new iteration exist, marks the run `done`/`failed` and emits `run_completed`.

`isRunning()` exposes the in-flight flag so the orchestrator does not re-enter while validators are spawning.

### 3.7 Planner Service (`src/daemon/planner-service.ts`)

Idempotent owner of the planner agent.

- `startPlanner(prompt)`: returns the existing planner if one is alive; otherwise wipes all task/agent dirs (`clearPreviousTasks`), creates a fresh `Plan` (status `drafting`, `max_iterations = 2`), spawns a planner agent with `PLANNER_PROMPT_PREFIX = "Initial user prompt:"`.
- An exit hook flips the plan to `awaiting_approval` once the planner emits at least one task. In autonomous mode it goes straight to `approved` and publishes `plan_approved`.
- `reset()`: kills planner, wipes state, writes a sentinel inert plan (status `done`).

### 3.8 Ask Router (`src/daemon/ask-router.ts`)

Mediates agent-to-human (or agent-to-pm) Q&A.

- `ask(fromAgent, question, options?)`: creates `PendingAsk`, writes the question to the live PM agent's stdin if present, returns a Promise.
- Two-tier timeout:
  - **Soft** (`ASK_TIMEOUT_MS`, default 300 s): in autonomous mode auto-answers `[ORQ-AUTO] ...`; otherwise upgrades the ask to `fallback` and republishes it so the UI can prompt the human.
  - **Hard** (`ASK_HARD_TIMEOUT_MS`, default 3600 s): always resolves with a "proceed with best judgment" string.
- `answer(askId, answer, fromAgent)`: only callable by a `pm` role or the `HUMAN_FALLBACK_AGENT_ID`.
- `recoverPendingAsks()`: on daemon restart, all `pending`/`fallback` asks are republished as `fallback` events.

The in-memory `Map<askId, { resolve, fallbackTimer, hardTimer }>` is what makes a daemon-lifetime Promise resolvable; the JSON file is the durable truth.

---

## 4. Agents

### 4.1 Pool (`src/agents/pool.ts`)

The pool is the only place a CLI process is born or buried. Public API:

| Method | Purpose |
|---|---|
| `spawn(role, cli, model, prompt, opts)` | Creates session dir, builds argv, instantiates `AgentTerminal`, registers in PlanStore, wires PTY → bus. Returns the `Agent` record. |
| `write(id, data)` | Forwards bytes/string to PTY stdin. |
| `resize(id, cols, rows)` | Resizes both PTY and headless emulator. |
| `kill(id)` | SIGHUP. |
| `waitForExit(id)` | Resolves with exit code (works for both live and tombstoned agents). |
| `getSnapshot(id)` | ANSI-encoded current viewport (live or last-seen-on-exit). |
| `getViewport(id)` | `{ cols, rows }`. |
| `subscribeTty(id, listener)` | Raw byte callback; returns unsubscribe. |
| `list()` | Live agent IDs. |

On every PTY data event the pool:

1. Streams UTF-8 decoding (incremental).
2. Line-buffers stdout.
3. For Claude, calls `parseLineFor("claude", line)` to extract `cli_session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `stop_reason`, `final_text`, `is_error` from JSON lines.
4. Publishes a `subtask_output` bus event.
5. Schedules the initial prompt (debounced) once the TUI is visibly ready.

On exit it flushes the buffer, writes terminal metadata to PlanStore (`status: dead`), and stores a final viewport snapshot for replay.

### 4.2 Terminal (`src/agents/terminal.ts`)

Couples three things into one object:

- `Bun.Terminal` PTY (default 100×30, 5000-line scrollback).
- `Bun.spawn` subprocess (`TERM=xterm-256color`, `COLORTERM=truecolor`).
- `@xterm/headless` emulator (server-side rendering for snapshots via `SerializeAddon`).

PTY data is fed to the headless terminal **and** the pool's data handler in parallel. `getSnapshot()` returns the current visible screen as an ANSI string.

### 4.3 Session Seeding (`src/agents/seed.ts`)

For every spawn, a directory `crew/sessions/<agentId>/` is created with files tailored to the chosen CLI:

- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` — role template (from `templates/roles/<role>.md`) plus the subtask prompt.
- `.mcp.json` — rendered from `templates/mcp.json.tmpl`, substituting `PORT`, `SESSION_ID`, `SESSION_TOKEN`. This is what makes the agent dial back into the daemon's MCP endpoint.
- For `codex`: writes `.codex/config.toml` (with trust entries and an `[mcp_servers.orquesta]` stanza pointing at `http://localhost:<port>/mcp/<agentId>?token=<token>`); symlinks `~/.codex/auth.json` into the session dir; sets `CODEX_HOME`.
- For `gemini`: writes `.gemini/settings.json` (folder trust off, `mcpServers.orquesta` with `httpUrl`); appends the session dir to `~/.gemini/trustedFolders.json`.

The function returns `{ dir, roleTemplate, env }`; the env is merged into the spawn.

### 4.4 Adapters (`src/agents/adapters/`)

A small dispatcher (`index.ts`) maps a `CliName` to its argv builder and line parser.

| CLI | Command | Special flags |
|---|---|---|
| `claude` | `claude --permission-mode bypassPermissions --dangerously-skip-permissions --model <model>` | Stream-JSON parser extracts session ID + final metrics. |
| `codex` | `codex --model <model> --dangerously-bypass-approvals-and-sandbox` | No line parser. |
| `gemini` | `gemini --model <model> --yolo` | No line parser. |

Adding a new CLI = add a file under `adapters/` and register it in `adapters/index.ts`.

---

## 5. The Bus & Journal

### 5.1 Bus (`src/bus/bus.ts`)

Synchronous in-process pub/sub.

```ts
bus.subscribe(filter, handler);   // filter: string | string[] | (event) => boolean
bus.publish(event);               // returns the TaggedBusEvent (with id + ts + tags)
```

Every `BusEvent` (the union in `core/types.ts:145`) is wrapped in a `TaggedBusEvent` `{ id, ts, tags, payload }` before fan-out and journal append.

### 5.2 Journal (`src/bus/journal.ts`)

Append-only SQLite log (`crew/journal.sqlite`).

```sql
CREATE TABLE events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  TEXT,
  ts        TEXT,
  type      TEXT,        -- indexed
  tags      TEXT,        -- JSON array
  payload   TEXT         -- JSON object
);
```

`query({ tagsIncludes?, sinceId?, limit? })` supports cursor-based pagination via `sinceId`. Tag filtering uses a `json_each` subquery. Default limit is 100.

This is also the source of truth replayed to a freshly opened WebSocket events client (last 100 events).

### 5.3 Event Catalogue

The full union is in `src/core/types.ts:145-168`. Highlights:

- Plan: `plan_approved`, `run_completed`
- Iteration: `iteration_started`, `iteration_completed`
- Task: `task_ready`, `task_started`, `task_completed`, `task_cancelled`, `task_merged`, `task_archived`, `tasks_emitted`
- Subtask: `subtask_started`, `subtask_output`, `subtask_completed`, `subtask_failed`
- Critic: `critic_findings`
- Agent: `agent_completed`, `agent_failed`
- Asks: `ask_user`, `ask_user_answered`, `ask_timed_out`
- Comms: `activity`, `broadcast`

---

## 6. Persistence Layer (`src/core/plan-store.ts`)

A single class `PlanStore(root)` is the durable authority for every entity. All writes are atomic: write to `.<base>.<pid>.<ts>.tmp`, `fsync`, `rename`.

Beyond CRUD, it provides:

- **State machines**: `transitionTask(id, newStatus, patch?)` and `transitionSubtask(taskId, id, newStatus, patch?)`. Both consult an allow-list (`taskTransitions`) and throw on illegal edges. Terminal states stamp `completed_at`.
- **Counters**: `recalculatePlanCounters()` recomputes `task_count` / `completed_count` and is auto-triggered by `saveTask`.
- **Validation**: `validateTaskGraph(tasks?)` checks for dangling deps and runs `detectCycle` from `core/dag.ts`.
- **Recovery**: `recoverInterruptedRun()` flips `running` → `pending` for tasks, `running` subtasks → `failed`, non-dead agents → `dead`.
- **Attempt tracking**: `incrementTaskAttempt(id)`.

### 6.1 Layout under `.orquesta/crew/`

```
crew/
  plan.json
  config.json
  journal.sqlite
  session.token
  tasks/<taskId>.json
  tasks/<taskId>.md            (closure summary)
  subtasks/<taskId>/<id>.json
  iterations/<id>.json
  agents/<id>.json
  asks/<id>.json
  sessions/<agentId>/...        (per-agent CWD; archived on close)
  worktrees/<runId>/<taskId>/   (git worktree)
  archive/<runId>/<taskId>/     (post-merge or post-fail archive)
```

---

## 7. The DAG (`src/core/dag.ts`)

Pure, side-effect-free graph utilities. The orchestrator reasons exclusively through these.

| Function | Purpose |
|---|---|
| `isTerminal(status)` | True for `done | failed | blocked | cancelled`. |
| `readySet(tasks)` | Tasks whose every dep is `done`. |
| `blockedByFailedDeps(tasks)` | Tasks with at least one dep `failed | blocked | cancelled` — they can never become ready. |
| `detectCycle(tasks)` | Iterative DFS with a grey/black set; returns the cycle list or `null`. |
| `rollupStatus(task, subtasks)` | Derives a task's status from its subtasks: any `failed` → `failed`; all `done` and last subtask is a critic with no findings → `done`; any `running` → `running`. |

Cycle detection is invoked by both `validateTaskGraph` and the `emit_tasks` MCP tool, so a planner cannot persist a cyclic DAG.

---

## 8. Git Layer (`src/core/git.ts`)

Synchronous wrapper around `git` via `Bun.spawnSync`. Naming is deterministic:

- Branch: `orq/<runId>/<taskId>` (chars sanitized to `[A-Za-z0-9._-]`).
- Worktree: `.orquesta/crew/worktrees/<runId>/<taskId>`.
- Archive: `.orquesta/crew/archive/<runId>/<taskId>`.

Key functions:

- `createTaskWorktree(root, taskId, baseBranch, runId)`: idempotent. Creates the worktree, writes a `.git/info/exclude` entry for `.orq/`, `.mcp.json`, `.orquesta-worktree`, then writes an **ownership marker** `.orquesta-worktree`.
- `isOrquestaOwnedWorktree(path)`: reads the marker. **Removal is gated on this** — Orquesta never deletes a directory it does not own.
- `hasUncommittedChanges(cwd)`: filters out `.orquesta/` lines from `git status --porcelain`.
- `autoCommitAll(cwd, message)`: `git add -A && git commit -m`. Returns the new HEAD or `null`.
- `mergeBranch(root, branch, baseBranch, title)`: `--no-ff` merge into base; aborts on failure; returns the merge SHA.
- `removeWorktree(root, path)`: ownership-checked `git worktree remove --force`.
- `archiveSessionDir(source, target)`: atomic `rename`.

---

## 9. The Model Context Protocol (MCP) Surface

Agents talk back to the daemon over MCP (JSON-RPC 2.0 over HTTP).

### 9.1 Endpoint

```
POST http://localhost:<port>/mcp/<agentId>?token=<sessionToken>
```

Authentication is checked from `x-orquesta-token` header, `Authorization: Bearer`, query string, or the `orquesta_token` cookie. Unauthorized → JSON-RPC error `-32001`, HTTP 401.

### 9.2 Methods

| Method | Description |
|---|---|
| `initialize` | Returns `protocolVersion: "2025-03-26"`, capabilities `{ tools: {} }`, server info. |
| `ping` | `{}`. |
| `tools/list` | Tool definitions (name + description + inputSchema). |
| `tools/call` | Dispatches to the handler in `src/mcp/tools.ts`. |

### 9.3 Tool Catalogue (`src/mcp/tools.ts`)

| Tool | Allowed roles | Effect |
|---|---|---|
| `ask_user` | any | Calls `AskRouter.ask`; blocks until human/pm answers; returns `{ answer }`. |
| `answer_peer` | `pm` | Resolves a pending ask. |
| `report_progress` | any | Updates `last_activity_at`; publishes `activity`. If `status="failed"`, transitions the bound subtask, emits `subtask_failed` (or `agent_failed`), kills the agent. |
| `report_complete` | any | Transitions bound subtask `→ done`, updates parent task summary, emits `subtask_completed`, kills the agent. |
| `request_review_subtask` | `critic` | Creates a new `fix` subtask from findings; appends to the parent task; transitions critic's own subtask `→ done`; publishes `critic_findings`; kills critic. |
| `emit_tasks` | `planner | architect | pm | qa` | Validates a DAG (`detectCycle`), assigns canonical IDs, persists, publishes `task_ready` for dep-free tasks and `tasks_emitted` for the batch. The planner (while drafting) may **replace** the current iteration's tasks. |
| `broadcast` | `pm` | Writes a message into a target agent's PTY stdin; publishes `broadcast`. |

Role enforcement is done by `requireRole(agentId, roles)` at the top of every handler. Every result is shaped as `{ content: [{ type: "text", text: JSON.stringify(value) }] }` (the MCP convention).

---

## 10. HTTP & WebSocket APIs (`src/api/`)

### 10.1 REST (`src/api/http.ts`)

Mutating routes are gated by a session token regex list. Body limit 64 KiB → HTTP 413.

| Method | Path | Purpose |
|---|---|---|
| POST | `/mcp/:agentId` | MCP passthrough (see §9). |
| GET  | `/api/health` | Liveness probe. |
| GET  | `/api/diagnostics` | Git state, CLI availability, counts. |
| GET  | `/api/planner/diagnostics` | Live planner agent record + last 8 KB of stdout + recent planner-tagged journal events. |
| GET  | `/api/export` | Full snapshot incl. last 1000 journal events. |
| GET  | `/api/runs/current` | Plan + tasks + iterations + agents + subtasks + plannerAgentId. **The UI's primary refresh endpoint.** |
| GET  | `/api/runs` | Array of runs (currently just the live one). |
| GET  | `/api/runs/:runId` | Plan + tasks + iterations for that run. |
| GET  | `/api/runs/:runId/iterations/:iterId` | Iteration + its tasks. |
| GET  | `/api/tasks` | All tasks. |
| GET  | `/api/tasks/:taskId` | Task + its subtasks. |
| GET  | `/api/tasks/:taskId/history` | Merge commit, branch, archive path, closure reason, diff stat. |
| GET  | `/api/archive` | Archived tasks (have `archive_path`). |
| GET  | `/api/agents` | All agent records. |
| POST | `/api/plan` | Start planner. 409 if a run is already approved/running. |
| POST | `/api/plan/reset` | `plannerService.reset()`. |
| POST | `/api/approve` | `plan.status = approved`, kill planner, publish `plan_approved`. |
| POST | `/api/agents/:agentId/input` | Write text into the agent's PTY; publish `broadcast`. |
| POST | `/api/agents/:agentId/resume` | Spawn a transient PTY that resumes the agent's CLI conversation by `cli_session_id` (Claude/Codex only) and returns its synthetic `ttyId` for `/tty/:ttyId`. |
| POST | `/api/tasks/:taskId/cancel` | Kill bound agents, set `cancelled`, publish `task_cancelled`. |
| POST | `/api/ask/:askId/answer` | Resolve a pending ask. |
| GET  | `/` | UI shell HTML; sets the session cookie. |
| GET  | `/theme.css`, `/assets/*` | Static UI assets. |

### 10.2 WebSocket (`src/api/ws.ts`)

Two channels:

**`/events`** — bus stream.
- On open: server replays the last 100 journal events.
- Server → client: serialized `TaggedBusEvent` JSON strings.
- Client → server: `{ type: "subscribe", tags: string[] }` updates the per-connection tag filter.
- Origin must match request host **or** equal `ORQ_CORS_ORIGIN`.

**`/tty/:agentId`** — live PTY mirror.
- Auth identical to REST (header / bearer / query / cookie).
- Server → client on open: a terminal reset (`ESC c`, `RIS`) is prepended to the agent's recorded output buffer (`pool.getOutputBuffer`) and sent as a single binary frame. This guarantees a clean xterm.js state for late connectors. After the replay, `pool.subscribeTty` streams continuous binary chunks. If the agent has already exited the server sends a yellow `[agent exited]` notice and closes with code 1000.
- Client → server: `{ type: "resize", cols, rows }`, `{ type: "stdin", data: string }`, or raw text/binary (treated as stdin). Stdin per frame is capped at 16 KiB → close with code 1009 if exceeded.
- The same channel handles **resume sessions**: clients open `/tty/<originalAgentId>:resume` after `POST /api/agents/:id/resume`.

State: `eventClients: Set<WS>` and `ttyClients: Map<agentId, Set<WS>>`. Cleanup is via the unsubscribe callback returned by `pool.subscribeTty`.

---

## 11. The CLI (`src/cli/orq.ts`)

The user-facing binary plus host of `runPlanner` (used by the daemon's planner service).

| Command | Behavior |
|---|---|
| `orq plan <prompt>` | POST `/api/plan` with the session token. If the daemon is unreachable, falls back to running the planner in-process. |
| `orq approve` | Writes `status = approved` directly into PlanStore. |
| `orq start` | Spawns `bun run src/daemon/index.ts` with inherited stdio. |
| `orq status` | Prints plan + task list. |
| `orq logs` | Reads the SQLite journal; prints the last 25 events. |
| `orq doctor` | Bun version, git, repo branch/dirty, CLI availability, token, crew dir, plan summary. |

`runPlanner(plan, config)` (internal) stands up a temporary Bun server on a random port, spawns a planner agent, waits for `agent_completed` or `ORQ_PLANNER_TIMEOUT_MS`, verifies at least one task was emitted, marks the plan `awaiting_approval`, and tears everything down.

The CLI ships with a default config when none exists: `claude-opus-4-7` for all seven roles, `concurrency.workers = 2`, `maxAttemptsPerTask = 3`, `maxWaves = 50`, `maxIterations = 2`.

---

## 12. The UI (`src/ui/`)

A single-page React 18 app, no external state library.

### 12.1 Layout

`index.html` mounts `<div id="root">`. `main.tsx` renders `<App>` into `div.app-shell` — a CSS Grid with three rows (`auto auto 1fr`).

`App` computes a mode via `resolveMode(plan, plannerAgent, taskCount)`:

- **`empty`** — only `<PlanPrompt>`.
- **`planner`** — two-column layout (`tasks | live-stream`) plus right column (`ChatComposer + ActivityFeed`); approval banner on `awaiting_approval`.
- **`run`** — `IterationNav` then a three-column body (`tasks | activity | agents+chat`) with `LiveStream` pinned below; `Toast` and `TerminalDrawer` overlay outside the flow.

### 12.2 State

All state lives in `useState` in `App`:

- Domain: `plan`, `tasks`, `iterations`, `agents`, `subtasks`, `plannerAgentId`.
- UI selection: `selectedTaskId`, `selectedAgentId`, `drawerAgentId`, `selectedIterationNumber`.
- `pinnedAgentIds: Set<string>` persisted to `localStorage["orq.pinnedAgents"]`.

Derived values are `useMemo`'d.

### 12.3 Backend Connectivity

- **Bus stream**: `useBus` opens a WebSocket to `/events`, parses each frame, keeps the last 200 events. Reconnects with exponential backoff (500 ms → 10 s).
- **REST refresh**: a `refresh()` helper hits `GET /api/runs/current` and rehydrates state.
- **Origin resolution**: all REST/WS URLs are prefixed by `DAEMON_HTTP` / `DAEMON_WS` from `src/ui/config.ts`, which read `VITE_DAEMON_URL`. When the bundle is served by the daemon itself (`/`), this is empty and requests are same-origin; when served by `ui-server` on a different port/host, the value points at the daemon URL.
- **Mutations**: `POST /api/plan`, `/api/approve`, `/api/plan/reset`, `/api/agents/:id/input`, `/api/ask/:id/answer`.

Bus events drive UI updates: lightweight events (e.g. `agent_completed`) mutate local state directly; structural events (`tasks_emitted`, `task_completed`, …) call `refresh()`.

### 12.4 Components

| Component | Role |
|---|---|
| `Shell` | Topbar (run ID, iteration). |
| `PlanPrompt` | Empty-mode prompt form → `POST /api/plan`. |
| `IterationNav` | Iteration indicator + prev/next + status badge. |
| `TasksPanel` | Tasks for current iteration; tree/list toggle (tree uses depth resolver over `depends_on`). |
| `ActivityFeed` | Reverse-chronological event log with filter pills (`all | mine | messages`). |
| `AgentsPanel` | Three groups: bound to selected task / other live / pinned-completed. Single-click select; double-click opens drawer. |
| `ChatComposer` | Single input → `POST /api/agents/:id/input`, prefixes `[human/pm]: `. |
| `LiveStream` | `WebTTY` for the focused agent; `LIVE` / `REPLAY` badge. |
| `TerminalDrawer` | Slide-over with full `WebTTY`. |
| `Toast` | Most recent fallback `ask_user`; option buttons or free-text → `POST /api/ask/:id/answer`. |
| `WebTTY` | xterm.js + `FitAddon` + `ClipboardAddon`. WebSocket to `/tty/:agentId`. Waits for the initial `viewport` JSON before allowing resizes. `ResizeObserver` keeps it fitted. `readOnly` mode for dead agents. |

### 12.5 Styling

`theme.css` defines a dark palette via CSS custom properties (`--bg`, `--panel`, `--accent`, role colors `--role-coder`, `--role-tester`, etc.). Inter / IBM Plex Sans for body; JetBrains Mono inside xterm theme.

---

## 13. Front-end Delivery Modes

The daemon is a **headless API**. Three front-ends sit on top of it; each connects through the same REST + WebSocket surface and is therefore optional.

### 13.1 Daemon-served (default, single port)

`bun run build:ui` produces `dist/ui/` (Vite). The daemon's HTTP handler serves `index.html`, `theme.css` and `/assets/*` from that directory on port `ORQ_PORT`. The bundle leaves `VITE_DAEMON_URL` empty so the SPA talks to the same origin. **No CORS, no second process.** This is what `orq start` ships.

### 13.2 Standalone Web UI server (`src/ui-server/`)

A 25-line Bun process (`bun run serve:ui`) that serves `dist/ui/` on `ORQ_UI_PORT` (default `4173`) without any business logic. Use it when:

- You want the UI on a different host than the daemon.
- You're iterating on UI assets without restarting the daemon.

The build is parameterised by `VITE_DAEMON_URL` at build time (the SPA picks it up via `src/ui/config.ts`). The daemon must be started with `ORQ_CORS_ORIGIN=<ui-origin>` so its CORS + WebSocket-origin checks accept the UI host. `scripts/dev.sh` and `bun run dev:separate` automate the two-process setup.

### 13.3 Go TUI (`tui/`)

A Bubble Tea / Lipgloss application built with `bun run build:tui` (which calls `go build`). It is **not** a thin client over the React UI; it is a separate native client that:

- Reads the session token from `<cwd>/.orquesta/crew/session.token` (so it must be run from the daemon's working directory).
- Polls `GET /api/runs/current` for plan/task/agent state.
- Subscribes to `/events` over WebSocket (auto-reconnect every 1 s on drop) and re-fetches run state on structural events (`task_*`, `subtask_*`, `tasks_emitted`, `iteration_*`, `plan_approved`, `agent_*`).
- Attaches to a selected agent's PTY by opening `/tty/:agentId` and streaming chunks into a scroll buffer.
- Issues mutations (`POST /api/approve`, `POST /api/plan/reset`, `POST /api/agents/:id/input`).

`ORQ_DAEMON_URL` overrides the daemon URL (default `http://localhost:8000`). Same auth model as the Web UI.

---

## 14. Test Strategy (`src/test/`)

Bun's built-in test runner. Roughly 21 files covering:

- **Pure**: `dag.test.ts`, `core.types.test.ts`, `plan-store.test.ts`, `git.test.ts` (uses real ephemeral repos).
- **Bus / Journal**: `bus.test.ts`, `journal.test.ts`.
- **Daemon**: `orchestrator.test.ts`, `orchestrator.waves.test.ts`, `task-closure.test.ts`, `ask-router.test.ts`, `planner-service.test.ts`.
- **HTTP**: `http.test.ts`, `http.cancel.test.ts`, `http.planner.test.ts`.
- **MCP**: `mcp.server.test.ts`, `mcp.tools.test.ts`.
- **Agents**: `adapters.test.ts`, `seed.test.ts`, `agent-pool.test.ts`.
- **End-to-end**: `e2e.happy.test.ts` exercises an entire run with mocked CLIs.
- **CLI**: `cli.wait.test.ts`.

Run with `bun test`. Type checking via `bun run typecheck`. Full gate: `bun run check` (typecheck + tests + build). The Go TUI has no automated tests yet — `cd tui && go vet ./... && go build ./...` is the baseline.

---

## 15. Operational Concerns

### 15.1 Ports & Hosts

The daemon binds `127.0.0.1:8000` by default — assume single-tenant local use. To expose externally, set `ORQ_HOST=0.0.0.0` and front it with TLS. The session token is the only auth mechanism. The standalone `ui-server` binds `0.0.0.0:ORQ_UI_PORT` (default `4173`) and serves only static assets — no auth, no daemon traffic. When the UI lives on a different origin than the daemon, set `ORQ_CORS_ORIGIN` on the daemon to that origin.

### 15.2 Failure Modes & Recovery

| Failure | Recovery |
|---|---|
| Daemon crash | `recoverInterruptedRun()` on next boot demotes `running` → `pending`, kills tombstoned agents. |
| Pending asks | `AskRouter.recoverPendingAsks()` republishes them as `fallback`. |
| Merge conflict | Worktree is **kept**; task is `failed` with `closure_reason = merge_conflict`; `task.merge_error` records the message. |
| Failed subtask | Worktree kept; task `failed` with `closure_reason = failed_subtask`. |
| Cyclic DAG | `emit_tasks` rejects with a JSON-RPC error before persistence. |
| Wave runaway | `config.work.maxWaves` triggers `Orchestrator.stop()`. |
| Per-task hang | `ORQ_SUBTASK_TIMEOUT_MS` cuts off a stuck subtask. |
| Per-iteration hang | `ORQ_ROLE_TIMEOUT_MS` cuts off a stuck validator. |

### 15.3 Authentication

`getOrCreateSessionToken(store)` writes a random token to `crew/session.token` on first boot. Every mutating REST route, every WebSocket, and every MCP request must present it via header, bearer, query, or cookie. The `/` GET sets it as an `httpOnly` cookie so the SPA picks it up automatically.

### 15.4 Adding a New Role

1. Add the role to the `Role` union in `src/core/types.ts` and to `RoleSchema` in `src/core/schemas.ts`.
2. Drop a markdown template in `templates/roles/<role>.md`.
3. Add a default team member in `src/cli/orq.ts`'s `defaultConfig`.
4. (If applicable) extend `requireRole` in `src/mcp/tools.ts` to grant the new role access to relevant tools.

### 15.5 Adding a New CLI

1. Create `src/agents/adapters/<cli>.ts` exporting `buildArgs(model, prompt, opts)` and (optionally) `parseLineFor(line)`.
2. Register it in `src/agents/adapters/index.ts`.
3. Add CLI-specific seeding to `src/agents/seed.ts` (config files, trust setup, env).
4. Extend `CliName` and `CliNameSchema`.

---

## 16. Known Boundaries

- **Single tenant, single host.** No HA, no multi-process coordination. The atomic-rename pattern protects against torn writes within one process; concurrent daemons against the same `.orquesta/crew/` would corrupt state.
- **One run at a time.** `POST /api/plan` returns 409 if a plan is already `approved`/`running`. The data model carries `runId` as a key, but only the `current` run is exposed.
- **Local-only auth.** The session-token model assumes the daemon is bound to `127.0.0.1` or behind a trusted reverse proxy.
- **Bun-only daemon.** The PTY (`Bun.Terminal`) and bundler (`Bun.build`) used by the daemon and `ui-server` are not portable to Node without rework. The Vite UI build is portable.
- **Web UI / TUI feature parity.** The Go TUI implements only the core viewer / approve / chat flow — no iteration navigation, archive browsing, or fallback-ask UI. Use the Web UI for full operation.

---

## 17. Quick Reference: Where Things Live

| You want to... | Look at |
|---|---|
| Add a REST endpoint | `src/api/http.ts` |
| Add a bus event type | union in `src/core/types.ts:145`, then publish from a daemon module |
| Add an MCP tool | `src/mcp/tools.ts` (definition + handler + role gate) |
| Change scheduling policy | `src/daemon/orchestrator.ts` |
| Change the code/test/critic loop | `src/daemon/task-pipeline.ts` |
| Change how a task is closed/merged | `src/daemon/task-closure.ts` |
| Change validator behavior between waves | `src/daemon/iteration-manager.ts` |
| Change persistence layout | `src/core/plan-store.ts` |
| Add a CLI | `src/agents/adapters/*` + `src/agents/seed.ts` |
| Change UI layout | `src/ui/main.tsx` (`resolveMode`) |
| Change how UI listens to bus | `src/ui/hooks/useBus.ts` |
| Change where the UI sends requests | `src/ui/config.ts` (reads `VITE_DAEMON_URL`) |
| Change terminal rendering | `src/ui/components/WebTTY.tsx` |
| Serve the prebuilt UI on its own port | `src/ui-server/index.ts` |
| Change Vite proxying for `bun run ui` | `vite.config.ts` |
| Change TUI views | `tui/internal/ui/{home,list,preview}.go` |
| Change TUI client | `tui/internal/client/{client,events,tty}.go` |
