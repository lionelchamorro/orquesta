# Orquesta

Orquesta is a Bun/TypeScript multi-agent orchestration app. It persists plan state under `.orquesta/crew/`, runs agent terminals through `Bun.Terminal`, exposes an MCP broker, and serves a React dashboard.

## Commands

- `bun run src/cli/orq.ts plan "your prompt"` creates a draft run and seeds tasks.
- `bun run src/cli/orq.ts approve` marks the run as approved.
- `bun run src/cli/orq.ts start` launches the daemon and dashboard on `ORQ_PORT` or `8000`.
- `bun run src/cli/orq.ts status` prints the current run status.

## Team configuration

Set `.orquesta/crew/config.json` with `team` entries per role. Each member defines `role`, `cli`, `model`, and optional `command`.

## Adding roles

Add a template in `templates/roles/` and extend the `Role` union in `src/core/types.ts`.
