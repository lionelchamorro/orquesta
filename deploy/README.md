# Orquesta all-in-one deploy

One container that serves the **frontend + api**, bundles the four agent CLIs
(**claude-code, codex, gemini, opencode**), and runs an **opencode server** —
all logged in via your **host credentials**, ready to sit behind an external
reverse proxy reached by IP.

## What runs inside

| Process        | Bind             | Exposed? | Role |
|----------------|------------------|----------|------|
| Next.js front  | `0.0.0.0:3000`   | **yes**  | the only public port; the proxy targets it |
| FastAPI api    | `127.0.0.1:8000` | no       | `ORQUESTA_API_URL`; spawns orq-lite per run |
| opencode serve | `127.0.0.1:4096` | no       | `OPENCODE_SERVER_URL`; backs the global chat |
| orq-lite       | ephemeral loopback | no     | one process **per run**, launched by the api |

Managed by `supervisord`; all logs go to `docker logs`.

## Why it's proxy-safe (the important part)

The browser **only calls same-origin `/api/*`** paths. Those are Next.js route
handlers that run *inside the container* and proxy server-side to the api
(`ORQUESTA_API_URL`) and opencode (`OPENCODE_SERVER_URL`). Those vars are
**server-only** (not `NEXT_PUBLIC_*`), so **no external IP is ever baked into
the frontend**. You can front it with any proxy at any IP/host and it just
works — and the FastAPI backend needs no CORS because the browser never hits it
directly.

> Do **not** set `NEXT_PUBLIC_ORQUESTA_API_URL` / `NEXT_PUBLIC_ORQ_LITE_API_URL`.
> They would embed a URL in the browser bundle and break this model.

## First-time setup

1. Log in once on the **host** with each CLI so the credential dirs exist:
   ```bash
   claude                 # ~/.claude, ~/.claude.json
   codex login            # ~/.codex
   gemini                 # ~/.gemini
   opencode auth login    # ~/.local/share/opencode, ~/.config/opencode
   ```
   (Missing dirs would otherwise be created root-owned by Docker and break the
   mounts.)

2. Build + run:
   ```bash
   cd deploy
   docker compose up -d --build
   ```

3. Point your TLS-terminating proxy at `http://<host-ip>:3000`
   (see `nginx.conf.example` — **SSE endpoints must be unbuffered**).

## Capping the build (host OOM guard)

`next build` can be memory-hungry. The image already caps the Node heap, but
cap the whole build on the host too:

```bash
systemd-run --scope -p MemoryMax=8G docker compose -f deploy/docker-compose.yml build
```

## Live events & chat — current state

- **Live events panel** uses the legacy global `/api/orq-lite/events`
  (single-project). It's **off by default** here because orq-lite is per-run in
  the multi-project model. To enable the legacy panel, run one `orq-lite serve`
  and set `ORQ_LITE_API_URL`. The proper fix is wiring the front to the api's
  per-run `/runs/{id}/logs` (via control-plane).
- **Global chat** posts to `${OPENCODE_SERVER_URL}/chat`, a custom contract
  vanilla `opencode serve` doesn't expose → `/api/chat` falls back to its mock
  reply. The opencode server still runs for CLI/API use; a small adapter would
  make the chat real.

## Interactive use

```bash
docker compose exec orquesta zsh
# claude / codex / gemini / opencode are on PATH and already logged in
```

## Persistence

Named volume `orquesta-data` holds the sqlite db, the editable `team.json`, and
cloned project workspaces under `/data`.
