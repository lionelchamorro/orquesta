# Orquesta — Agent Onboarding

You are an AI agent working on the Orquesta codebase. Read this file first, then load the docs it points at before touching code.

## 1. Read the architecture before editing

- **Always start with `docs/ARCHITECTURE.min.md`.** It is the condensed map of the system: directory layout, domain model, daemon boot sequence, REST/WS surface, and where each concern lives. Read it in full at the start of every session — it is short on purpose.
- **Drop into `docs/ARCHITECTURE.md` for depth** only when the minified doc points to a section that is relevant to your task (e.g. you're touching the task pipeline → read §3.4; you're adding an MCP tool → read §9).
- Do not skim; the daemon has many invariants (state-machine transitions, ownership markers, atomic writes) that are easy to break.

## 2. Code structure cheatsheet

```
src/agents/      Process pool, PTY, per-CLI adapters, session seeding
src/api/         HTTP handler + WebSocket upgrades (REST/WS surface)
src/bus/         In-process pub/sub + SQLite event journal
src/cli/         orq CLI entry point
src/core/        Pure types, schemas, DAG, plan-store, git, session token
src/daemon/      Orchestrator, task pipeline + closure, iteration manager,
                 ask router, planner service, daemon entry
src/mcp/         JSON-RPC server + tool registry
src/ui/          React 18 + Vite + xterm dashboard
src/ui-server/   Standalone Bun static server for the SPA
src/test/        Bun test suite
tui/             Go (Bubble Tea) terminal client
templates/       Role markdown + .mcp.json template
.orquesta/crew/  Runtime state — never commit
```

## 3. Things to know before changing anything

- **State machines are guarded.** `PlanStore.transitionTask` / `transitionSubtask` reject illegal edges. Use them; do not write status fields directly.
- **Atomic writes.** All JSON persistence goes through `PlanStore` (`.tmp` + `fsync` + `rename`). Do not `Bun.write` plan artifacts directly.
- **Worktree ownership.** Orquesta only deletes worktrees that contain the `.orquesta-worktree` marker. Preserve `isOrquestaOwnedWorktree` checks when refactoring `src/core/git.ts` or `src/daemon/task-closure.ts`.
- **Bus → Journal.** Every `bus.publish(event)` is wrapped in `TaggedBusEvent` and appended to SQLite. Adding an event type means updating the union in `src/core/types.ts`.
- **MCP role gates.** Every tool handler in `src/mcp/tools.ts` calls `requireRole(agentId, [...])`. New roles or tools must update both the tool handler and `RoleSchema`.
- **Auth.** Mutating REST routes, all WebSockets, and every MCP request must accept the session token (`x-orquesta-token` / Bearer / `?token=` / cookie). Don't add a new mutating route without listing it in the `mutatingRoutes` regex array.
- **No `Bun.build` of the UI inside the daemon anymore.** The daemon serves prebuilt assets from `dist/ui/`. UI changes need `bun run build:ui` (or the Vite dev server) before they appear.
- **Cross-origin mode** (separated UI / TUI) requires `ORQ_CORS_ORIGIN` on the daemon and `VITE_DAEMON_URL` baked into the UI bundle.

## 4. Workflow

1. Read `docs/ARCHITECTURE.min.md` (and the full doc as needed).
2. Plan the change — for anything non-trivial, write a short plan first.
3. Run the test suite for fast feedback: `bun test`.
4. Type-check: `bun run typecheck`.
5. Full gate before claiming done: `bun run check` (typecheck + tests + build).
6. UI changes: rebuild `bun run build:ui` if you want them served by the daemon, or use `bun run ui` (Vite dev server with proxy) for live reload.
7. TUI changes: `cd tui && go vet ./... && go build ./...`.

## 5. What not to touch without strong reason

- The 500 ms orchestrator tick (`src/daemon/orchestrator.ts`) — concurrency is bounded there.
- `recoverInterruptedRun()` on every daemon boot (`src/core/plan-store.ts`).
- The atomic-rename pattern in `PlanStore`.
- The `taskTransitions` allow-list.
- The MCP role-gating logic.

If you need to touch any of the above, justify it in the plan and verify with the relevant test file (`orchestrator.test.ts`, `plan-store.test.ts`, `mcp.tools.test.ts`, etc.).

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `lionelchamorro/orquesta`, accessed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
