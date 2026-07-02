# Deploying orquesta

orquesta ships as two containers: `api` (FastAPI control plane, includes the
`orq-lite` binary it supervises) and `web` (the Next.js console). Both are
built from the same [`Dockerfile`](../Dockerfile) via build targets.

## Quick start (docker compose)

```bash
git clone <this repo> && cd orquesta
# Create a .env file with at least AUTH_TOKEN set (see "Environment
# variables" below for the full list docker compose will read from it).
echo "AUTH_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up --build
```

`docker compose` builds both images, starts `api` on `:8000` and `web` on
`:3000`, and persists the database + all managed workspaces in the
`orquesta-data` named volume. The `web` service waits for `api`'s
healthcheck before starting.

`AUTH_TOKEN` is required — both `docker-compose.yml`'s `api` and `web`
services fail to start (via `${AUTH_TOKEN:?...}`) without it, and the API
itself refuses to boot with `ENV=production` and no token configured
(Task 12's `startup_check()`).

## Environment variables

Create a `.env` file next to `docker-compose.yml` (docker compose loads it
automatically) with the variables below. `.env` is gitignored — never commit
real secrets.

### Backend (`orquesta_api`)

| Variable | Default | Notes |
|---|---|---|
| `ENV` | `development` | `production` refuses to start with `AUTH_TOKEN` unset. |
| `DATABASE_URL` | `sqlite+aiosqlite:///./orquesta_api.db` | Set to `sqlite+aiosqlite:////data/orquesta_api.db` in the container (already the image default). |
| `RUN_EXECUTOR` | `local` | `docker` requires Task 14's DockerExecutor. |
| `WORKSPACES_DIR` | `./workspaces` | `/data/workspaces` in the container (already the image default). |
| `ORQ_LITE_BIN` | `orq-lite` | `/usr/local/bin/orq-lite` in the container (already the image default). |
| `ORQ_LITE_IMAGE` | `orq-lite:latest` | Only used by the Docker executor (Task 14). |
| `AUTH_TOKEN` | *(empty)* | **Required in production.** Bearer token every API request needs (except `GET /health`). |
| `GITHUB_WEBHOOK_SECRET` | *(empty)* | HMAC secret configured on the GitHub webhook (Settings > Webhooks > Secret). Empty disables signature verification — dev only. |
| `ANTHROPIC_API_KEY` | *(empty)* | Powers the admin chat (Task 11). Empty leaves chat non-functional. |
| `CHAT_MODEL` | `claude-sonnet-5` | |
| `CREDS_MOUNTS` | `~/.claude,~/.codex,~/.gemini` | Comma-separated host paths mounted read-only into agent CLI invocations. |
| `LOG_LEVEL` | `INFO` | |

### Frontend (Next.js)

| Variable | Default | Notes |
|---|---|---|
| `ORQUESTA_API_URL` | *(empty)* | Base URL of the `api` service. Empty disables all control-plane data fetching — pages render an honest empty/error state, never mock data, unless `ORQUESTA_DEMO=1`. |
| `ORQUESTA_API_TOKEN` | *(empty)* | Must match `AUTH_TOKEN`. Server-side only — never a `NEXT_PUBLIC_*` var (would ship it to every browser). |
| `ORQUESTA_UI_PASSWORD` | *(empty)* | Single-user v1 dashboard login gate (Task 12). Empty disables the gate. |
| `ORQUESTA_DEMO` | *(empty)* | Set to `1` to fall back to `lib/mock-data.ts` when the control plane is unreachable or unconfigured. Leave unset in any real deployment. |

## What the containers do NOT seed

The API image does **not** ship or seed a `flows.json`/`team.json` "deploy
config" anywhere in `/data`. Config is per-workspace: `orq-lite init`
generates it inside each project's own workspace directory the first time a
run launches there (`ensure_workspace_ready`, Task 1). Seeding a global
config in `/data` would silently apply to every project and reintroduce the
config-corruption gap Task 5 fixed.

## orq-lite version pin

The `orq-lite` binary is built from source in the `orq-lite` build stage,
pinned by the `ORQ_LITE_VERSION` build arg (default `v0.2.0` — the latest
published tag as of this writing; never `latest`). Go module resolution is
content-addressed once a tag resolves (`go.sum`), so this pin is as
reproducible as pinning a release binary sha would be. Bump it explicitly:

```bash
docker compose build --build-arg ORQ_LITE_VERSION=v0.2.1 api
```

## Database migrations

The `api` container's entrypoint runs `alembic upgrade head` before starting
uvicorn on every restart. A fresh, empty database is bootstrapped and
stamped automatically by the app itself (`ensure_schema_current`, Task 17);
an existing database with schema changes pending is migrated by that same
`alembic upgrade head` call. There is no separate manual migration step for
normal deploys — just restart the container after pulling a new image.

## Credentials for agent CLIs

`orq-lite` shells out to `claude`/`codex`/`gemini` CLIs, which read their own
credential files from the paths in `CREDS_MOUNTS`. `docker-compose.yml`
mounts `~/.claude`, `~/.codex`, and `~/.gemini` from the host read-only into
the `api` container at the same paths under `/home/orquesta`. Adjust the
mount list if your deployment host stores credentials elsewhere, or if
you're running a headless CI-style deploy where those CLIs authenticate via
environment variables instead of files.

## Reverse proxy / TLS

Neither container terminates TLS. Put a reverse proxy (nginx, Caddy,
Cloudflare Tunnel, your cloud LB) in front of `web` (`:3000`) for the public
console, and keep `api` (`:8000`) reachable only from `web` and from
GitHub's webhook IP ranges (for `/webhooks/github`) — never expose `api`
directly to the public internet unless every route genuinely needs to be
internet-facing.
