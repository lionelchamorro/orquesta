# Orquesta

Orquesta is a Bun/TypeScript multi-agent orchestration daemon. A planner agent emits a DAG of tasks; an orchestrator drives them through `coder → tester → critic → fix` waves inside isolated git worktrees, with `architect / pm / qa` validators at each iteration boundary. State is persisted as JSON + a SQLite event journal under `.orquesta/crew/`. Three optional front-ends ship in this repo: an in-process React Web UI, a standalone Web UI server, and a Go (Bubble Tea) TUI.

> **Architecture:** see `docs/ARCHITECTURE.md` (full) and `docs/ARCHITECTURE.min.md` (condensed). Agents working on the codebase should also read `AGENTS.md`.

## Requirements

- Bun ≥ 1.3.5
- Git
- Go ≥ 1.22 (only if you want to build the TUI)
- At least one of `claude`, `codex`, `gemini` available on `PATH` (these are the agent CLIs Orquesta spawns)

## Install dependencies

```bash
bun install
cd tui && go mod download && cd ..    # only if you'll build the TUI
```

---

## Build

The repo produces three independent artifacts.

| Artifact | Command | Output |
|---|---|---|
| Daemon (server bundle) | `bun run build:daemon` | `dist/daemon/` |
| Web UI (Vite bundle)   | `bun run build:ui`     | `dist/ui/` |
| Go TUI (native binary) | `bun run build:tui`    | `dist/orq-tui` |

Build daemon + UI together with `bun run build`. Full gate (typecheck + tests + build): `bun run check`.

## Install `orq` as a command-line program

The CLI source is `src/cli/orq.ts`. Compile it to a standalone executable with Bun and put it on your `PATH`:

```bash
# 1. compile the CLI into a single binary
bun build src/cli/orq.ts --compile --outfile dist/orq

# 2. install it somewhere on your PATH
mkdir -p ~/.local/bin
ln -sf "$(pwd)/dist/orq" ~/.local/bin/orq

# 3. verify
orq doctor
```

`bun build --compile` bakes Bun and the script into one file, so `orq` works without `bun run` going forward. (The TUI binary is similarly portable: `cp dist/orq-tui ~/.local/bin/orq-tui`.)

If you'd rather not compile, you can also do:

```bash
ln -sf "$(pwd)/scripts/orq.sh" ~/.local/bin/orq
```

…with a one-line wrapper at `scripts/orq.sh`:

```sh
#!/usr/bin/env sh
exec bun run "$(dirname "$0")/../src/cli/orq.ts" "$@"
```

### `orq` subcommands

| Command | What it does |
|---|---|
| `orq plan "<prompt>"` | POST to a running daemon at `/api/plan`. If no daemon is reachable, runs the planner in-process. |
| `orq approve` | Marks the current plan `approved`. |
| `orq start` | Spawns the daemon (`bun run src/daemon/index.ts`) with inherited stdio. |
| `orq status` | Prints plan + task list. |
| `orq logs` | Tails the last 25 events from the SQLite journal. |
| `orq doctor` | Bun version, git state, CLI availability, token, crew dir, plan summary. |

---

## Run

There are three ways to run Orquesta locally. Pick one based on whether you want a UI on top.

> All modes need a working git repository in the directory you're running from. Otherwise the daemon refuses to plan unless you set `git.enabled=false` in `.orquesta/crew/config.json`.

### A) Daemon only (headless / API-only)

The daemon exposes the full REST + WebSocket + MCP surface on `http://127.0.0.1:8000`. No UI is served beyond the prebuilt `dist/ui/` if it exists.

```bash
# from your project's root (the directory you want Orquesta to manage)
orq start
# or, without the compiled CLI:
bun run dev
```

Drive it from another terminal:

```bash
orq plan "refactor the auth module to use JWT and add a test suite"
orq status
orq approve              # only after the plan is awaiting_approval
```

Inspect events:

```bash
orq logs
curl -s http://127.0.0.1:8000/api/health
curl -s -H "x-orquesta-token: $(cat .orquesta/crew/session.token)" \
     http://127.0.0.1:8000/api/runs/current | jq
```

**Example — autonomous, no human gating:**

```bash
ORQ_AUTONOMOUS=true ORQ_PORT=8000 orq start
orq plan "add structured logging to every request handler"
# planner auto-approves; orchestrator runs to completion
```

### B) Daemon + Web UI

This is the default end-user experience: React dashboard with live xterm panes, served by the daemon at `/`.

```bash
# 1. build the UI once (only needs to be re-done when UI assets change)
bun run build:ui

# 2. start the daemon — it will serve dist/ui/ automatically
orq start
```

Open http://127.0.0.1:8000/ — the daemon sets the session token as an `httpOnly` cookie, so the SPA authenticates automatically.

**Example — separated UI server (UI on its own port, e.g. for a remote daemon):**

```bash
# Terminal 1: daemon, allowing CORS from the UI origin
ORQ_CORS_ORIGIN=http://localhost:4173 orq start

# Terminal 2: build the SPA pointed at the daemon, then serve it
VITE_DAEMON_URL=http://localhost:8000 bun run build:ui
bun run serve:ui                     # http://localhost:4173
```

Or, in dev mode with hot reload (Vite dev server + daemon together):

```bash
bun run dev:all                      # uses scripts/dev.sh
# daemon → http://localhost:8000
# vite   → http://localhost:4173 (proxies /api, /events, /tty, /mcp)
```

### C) Daemon + TUI

A native Go terminal client (Bubble Tea + Lipgloss). Keys: `j/k` move, `enter` attach to an agent's PTY, `r` refresh, `q` quit.

```bash
# 1. build the TUI binary (one time)
bun run build:tui                    # produces dist/orq-tui

# 2. start the daemon in one terminal
orq start

# 3. in another terminal, from the SAME working directory, run the TUI
dist/orq-tui
# or, after copying it onto $PATH:
orq-tui
```

The TUI reads the session token from `<cwd>/.orquesta/crew/session.token`, so it must be launched from the same directory as the daemon. To point at a daemon on a different host:

```bash
ORQ_DAEMON_URL=http://192.168.1.42:8000 orq-tui
```

**Example — daemon on a remote host, TUI locally:**

```bash
# remote
ORQ_HOST=0.0.0.0 ORQ_CORS_ORIGIN=http://localhost:4173 orq start

# local (token must be copied from the remote `.orquesta/crew/session.token`)
ORQ_DAEMON_URL=http://remote.host:8000 orq-tui
```

---

## Configuration

Per-run config lives at `.orquesta/crew/config.json`. The defaults (see `src/cli/orq.ts`'s `defaultConfig`) use `claude-opus-4-7` for every role, `concurrency.workers = 2`, `maxAttemptsPerTask = 3`, `maxWaves = 50`, `maxIterations = 2`. Override per-role CLI/model:

```json
{
  "team": [
    { "role": "planner",   "cli": "claude", "model": "claude-opus-4-7" },
    { "role": "coder",     "cli": "codex",  "model": "gpt-5" },
    { "role": "critic",    "cli": "gemini", "model": "gemini-2.5-pro" }
  ]
}
```

### Useful environment variables

| Var | Default | Effect |
|---|---|---|
| `ORQ_PORT` | `8000` | Daemon HTTP/WS port. |
| `ORQ_HOST` | `127.0.0.1` | Daemon bind address. |
| `ORQ_AUTONOMOUS` | `false` | Auto-approve plans, auto-answer asks after timeout. |
| `ORQ_CORS_ORIGIN` | unset | Allow cross-origin requests from this origin (separated UI / TUI). |
| `ORQ_UI_PORT` | `4173` | Port for `bun run serve:ui`. |
| `VITE_DAEMON_URL` | `http://localhost:8000` | Daemon URL baked into the UI bundle (build-time). |
| `ORQ_DAEMON_URL` | `http://localhost:8000` | Daemon URL the Go TUI dials. |
| `ORQ_SUBTASK_TIMEOUT_MS` | `300000` | Per-subtask wall-clock limit. |

Full list in `docs/ARCHITECTURE.md` §3.2.

---

## Project layout

```
src/agents/      Agent process pool, PTY, per-CLI adapters, session seeding
src/api/         REST + WebSocket
src/bus/         Pub/sub + SQLite journal
src/cli/         orq CLI
src/core/        Pure types, schemas, DAG, plan-store, git, session token
src/daemon/      Orchestrator, task pipeline, iteration manager, ask router
src/mcp/         JSON-RPC 2.0 server + tool registry
src/ui/          React 18 dashboard
src/ui-server/   Standalone Bun static server for the SPA
src/test/        Bun test suite
tui/             Go (Bubble Tea) terminal client
templates/       Role markdown + .mcp.json template
scripts/         dev.sh and helpers
```

## Adding roles or CLIs

- New role: extend `Role` in `src/core/types.ts`, add `templates/roles/<role>.md`, add a default team member in `src/cli/orq.ts`, extend `requireRole` in `src/mcp/tools.ts` if it needs MCP access.
- New CLI: drop a file in `src/agents/adapters/`, register it in `adapters/index.ts`, extend `seed.ts` with any per-CLI config files, extend `CliName` / `CliNameSchema`.
