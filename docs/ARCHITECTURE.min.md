# Orquesta — Minified Architecture

A condensed map of the codebase. For depth, see `docs/ARCHITECTURE.md`.

## What it is
A single-tenant Bun daemon that orchestrates AI coding-agent CLIs (`claude`, `codex`, `gemini`) through an externally supplied Task DAG, wave execution, and iteration loop. Each task runs in its own git worktree. State lives under `.orquesta/crew/`. Three optional front-ends (Web UI, standalone Web UI server, Go TUI) sit on top of the same REST + WebSocket API.

## Directories
```
src/
  agents/      Pool, PTY (Bun.Terminal + xterm headless), per-CLI adapters, session seeding
  api/         http.ts (REST + UI bundle serving) + ws.ts (/events bus, /tty PTY mirror)
  bus/         In-process pub/sub + SQLite journal (event log)
  cli/         orq.ts — run start/cancel / skill / migrate / start / status / logs / doctor
  core/        Pure: types, Zod schemas, DAG utils, plan-store, git wrapper, session token
  daemon/      orchestrator, task-pipeline, task-closure, iteration-manager,
               ask-router, index.ts (boot)
  mcp/         JSON-RPC 2.0 server + tool registry agents call back into
  ui/          React 18 + Vite + xterm.js dashboard
  ui-server/   25-line Bun static server for the prebuilt SPA
  test/        ~21 Bun tests
tui/           Go (Bubble Tea) terminal client
templates/     Role markdown + .mcp.json template
scripts/dev.sh Daemon + Vite together
dist/          build:daemon, build:ui, build:tui outputs
.orquesta/crew/ Runtime durable state (json, sqlite, worktrees, archives, session.token)
```

## Domain model (`src/core/types.ts`)
- `Plan` — a run. Status: `running → done|failed|failed_quota`.
- `Task` — DAG node. Owns a worktree + 1..N subtasks. Status: `pending → ready → running → done|failed|blocked|cancelled`.
- `Subtask` — `code | test | critic | fix | custom`. Status: same enum as Task.
- `Iteration` — wave boundary; trigger `initial | architect_replan | qa_regression`.
- `Agent` — one spawned CLI process bound 1:1 to a subtask or validator. Status `idle | working | live | dead`.
- `PendingAsk` — blocked `ask_user` MCP call.
- `Role` — `coder | tester | critic | architect | pm | qa`.
- State transitions are guarded by an allow-list in `PlanStore.transitionTask` / `transitionSubtask`.

## Three phases of a run
1. **Ingestion** — day mode produces a DAG externally and submits it through `POST /api/runs`; the run starts in `running`.
2. **Execution** — Orchestrator dispatches `readySet(DAG)` in waves; each task runs `coder → tester → critic → fix-loop` (≤ `maxAttemptsPerTask`) inside its own worktree, then `closeTask` does merge + archive.
3. **Iteration boundary** — when a wave empties, `IterationManager` runs `architect → pm → qa` (sequentially) which may emit refinement tasks. Loops until `max_iterations` or empty.

## Daemon (`src/daemon/index.ts`)
Boots `PlanStore`, session token, `Journal` (SQLite), `Bus`, `AgentPool`, `AskRouter`, `TaskPipeline`, `IterationManager`, `Orchestrator`, MCP handler, HTTP handler, WS handlers; calls `recoverInterruptedRun()` on every boot. The daemon does **not** bundle the UI — it serves prebuilt assets from `dist/ui/`.

### Orchestrator (500 ms tick)
- Computes `readySet`; while `running.size < concurrency.workers`, dispatches `pipeline.run(task)` without awaiting.
- `IterationManager.isRunning()` is a mutex against re-entry.
- `config.work.maxWaves` is a hard safety brake.

### Task Pipeline
1. Create worktree (`createTaskWorktree`) → branch `orq/<runId>/<taskId>`.
2. `coder` subtask → on no diff → `closureReason = no_changes`.
3. `tester` (sees `git diff --stat` + truncated diff body).
4. `critic` (same diff). Empty findings → done. Otherwise emits `fix` subtasks via `request_review_subtask`.
5. Fix loop ≤ `maxAttemptsPerTask`.
6. `closeTask` always: kills agents, decides merge (only on `critic_ok | max_attempts` with worktree present), runs `autoCommitAll` + `mergeBranch --no-ff`. Worktree is **kept** on `merge_conflict` / `failed_subtask`; otherwise archived.

### Ask Router
- Soft timeout (`ASK_TIMEOUT_MS`, 300 s) → `fallback` (autonomous mode auto-answers `[ORQ-AUTO]`).
- Hard timeout (`ASK_HARD_TIMEOUT_MS`, 3600 s) → "proceed with best judgment".
- `recoverPendingAsks()` re-emits `fallback` events on daemon restart.

## Bus & Journal (`src/bus/`)
Synchronous pub/sub; every event is wrapped as `TaggedBusEvent { id, ts, tags, payload }`, fanned out to subscribers, and appended to `crew/journal.sqlite`. New WebSocket events clients receive the last 100 events on connect.

## MCP surface (`src/mcp/tools.ts`)
Endpoint: `POST /mcp/<agentId>?token=<sessionToken>`. Tools (with role gates):
- `ask_user` (any) → blocking ask via `AskRouter`.
- `answer_peer` (pm) → resolves a pending ask.
- `report_progress` (any) → `activity` event; `failed` kills the agent.
- `report_complete` (any) → marks subtask done, kills agent.
- `request_review_subtask` (critic) → creates `fix` subtask + `critic_findings` event.
- `emit_tasks` (architect | pm | qa) → validates DAG (`detectCycle`), persists, emits `tasks_emitted`.
- `broadcast` (pm) → writes to a target agent's PTY stdin.

## HTTP / WS (`src/api/`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/diagnostics`, `/api/export` | Liveness / state dumps |
| GET | `/api/runs/current`, `/api/runs`, `/api/runs/:id`, `/api/runs/:id/iterations/:iterId` | Run state |
| GET | `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/history`, `/api/archive`, `/api/agents` | Entity reads |
| POST | `/api/runs`, `/api/runs/:id/cancel` | Run lifecycle |
| POST | `/api/agents/:id/input`, `/api/agents/:id/resume` | Agent control (resume = re-attach to a finished CLI session) |
| POST | `/api/tasks/:id/cancel`, `/api/ask/:id/answer` | Mutations |
| GET | `/`, `/theme.css`, `/assets/*` | UI shell + static |

WebSocket: `/events` (tagged bus stream + 100-event replay) and `/tty/:agentId` (terminal reset + buffer replay then live PTY chunks; stdin capped 16 KiB per frame).

Auth (mutating routes + `/tty`): session token via `x-orquesta-token` header, `Authorization: Bearer`, `?token=`, or `orquesta_token` cookie. CORS opt-in via `ORQ_CORS_ORIGIN`.

## Front-ends
- **Daemon-served Web UI** (default): `bun run build:ui` → `dist/ui/` → daemon serves on `ORQ_PORT`. Same-origin, no CORS.
- **Standalone UI server**: `bun run serve:ui` (`src/ui-server/index.ts`) on `ORQ_UI_PORT` (4173). UI built with `VITE_DAEMON_URL` set to the daemon origin; daemon must run with `ORQ_CORS_ORIGIN` set.
- **Go TUI** (`tui/`, Bubble Tea): reads `.orquesta/crew/session.token` from cwd, `ORQ_DAEMON_URL` for the API base. REST polling + `/events` subscription + `/tty/:id` attach.

## Persistence layout (`.orquesta/crew/`)
```
plan.json, config.json, journal.sqlite, session.token
tasks/<id>.json, tasks/<id>.md
subtasks/<taskId>/<id>.json
iterations/<id>.json, agents/<id>.json, asks/<id>.json
sessions/<agentId>/...        per-agent CWD (archived on close)
worktrees/<runId>/<taskId>/   git worktree (kept on merge_conflict/failed_subtask)
archive/<runId>/<taskId>/     post-merge or post-fail archive
```

## Where to look
| Goal | File |
|---|---|
| Add REST endpoint | `src/api/http.ts` |
| Add bus event type | `src/core/types.ts` (BusEvent union) |
| Add MCP tool | `src/mcp/tools.ts` |
| Change scheduling | `src/daemon/orchestrator.ts` |
| Change code/test/critic loop | `src/daemon/task-pipeline.ts` |
| Change merge/archive | `src/daemon/task-closure.ts` |
| Change wave-boundary validators | `src/daemon/iteration-manager.ts` |
| Change persistence | `src/core/plan-store.ts` |
| Add a CLI | `src/agents/adapters/*` + `src/agents/seed.ts` |
| Change UI layout | `src/ui/main.tsx` |
| UI ↔ daemon URL | `src/ui/config.ts` (`VITE_DAEMON_URL`) |
| TUI views | `tui/internal/ui/*.go` |
| TUI client | `tui/internal/client/*.go` |

## Env knobs
`ORQ_PORT` (8000), `ORQ_HOST` (127.0.0.1), `ORQ_CORS_ORIGIN`, `ORQ_UI_PORT` (4173), `VITE_DAEMON_URL`, `ORQ_DAEMON_URL`, `ORQ_AUTONOMOUS`, `ORQ_SUBTASK_TIMEOUT_MS`, `ORQ_ROLE_TIMEOUT_MS`, `ORQ_INITIAL_PROMPT_DELAY_MS`, `ORQ_INITIAL_PROMPT_SUBMIT_DELAY_MS`, `ORQ_CWD` (used by `scripts/dev.sh`).
