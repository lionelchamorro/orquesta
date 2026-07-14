# syntax=docker/dockerfile:1.7
#
# Orquesta all-in-one deploy image.
#
# One container that serves the whole product behind an external reverse proxy:
#   - Next.js frontend  -> 0.0.0.0:3000   (the ONLY exposed port; proxy targets it)
#   - FastAPI backend    -> 127.0.0.1:8000 (loopback; ORQUESTA_API_URL)
#   - opencode server    -> 127.0.0.1:4096 (loopback; OPENCODE_SERVER_URL)
#   - orq-lite binary    -> spawned per-run by the api on ephemeral loopback ports
#   - claude / codex / gemini / opencode CLIs installed (used by the executor and
#     available for interactive `docker exec`)
#
# The frontend never talks to the api from the browser: it proxies server-side
# via same-origin /api/* route handlers, so NO external IP is ever baked in.
# That is what makes this safe behind a proxy reached by IP. Do NOT set any
# NEXT_PUBLIC_*_URL var — it would embed a URL in the browser bundle and break
# the proxy model.
#
# Build (from the repo root):
#   docker build -f deploy/Dockerfile -t orquesta:local .
# or via deploy/docker-compose.yml (recommended — wires credential mounts).

############################################################
# Stage 1 — fetch the real orq-lite release (the flow engine lives upstream in
# github.com/lionelchamorro/orquesta-lite; this repo's ./cmd/orq-lite is an
# older fork with no `flow` command) plus its version-matched default configs.
############################################################
FROM debian:bookworm-slim AS orqlite
ARG ORQ_LITE_VERSION=v0.2.0
ARG ORQ_LITE_SHA256=7677defca9cfe2e45baae50f12374282e343f415ae9a0d0945f33a83e1e2953a
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /out
# Binary (sha-pinned release tarball -> /out/orq-lite).
RUN curl -fsSL -o orq.tgz \
      "https://github.com/lionelchamorro/orquesta-lite/releases/download/${ORQ_LITE_VERSION}/orq-lite-${ORQ_LITE_VERSION}-linux-amd64.tar.gz" \
    && echo "${ORQ_LITE_SHA256}  orq.tgz" | sha256sum -c - \
    && tar xzf orq.tgz \
    && mv "orq-lite-${ORQ_LITE_VERSION}-linux-amd64/orq-lite" /out/orq-lite \
    && chmod +x /out/orq-lite \
    && rm -rf orq.tgz "orq-lite-${ORQ_LITE_VERSION}-linux-amd64"
# GitHub CLI (gh): orq-lite's `watch`/`review` commands and the factory `--pr`
# step shell out to it (gh issue list, gh pr create/diff/checkout). Without it
# `orq-lite watch` errors every tick with "gh: executable file not found".
ARG GH_VERSION=2.96.0
RUN curl -fsSL -o gh.tgz \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && tar xzf gh.tgz \
    && mv "gh_${GH_VERSION}_linux_amd64/bin/gh" /out/gh \
    && rm -rf gh.tgz "gh_${GH_VERSION}_linux_amd64"
# Version-matched default configs. As of v0.2.0 the defaults are embedded in the
# binary (no root flows.json/team.json to fetch), and `orq-lite init` scaffolds
# flows.json (factory, factory_fast) + team.json + prompts/ + schemas/. The
# flow engine loads flows.json + prompts/<role>.md from the run's working dir.
RUN mkdir -p /out/scaffold && cd /out/scaffold && git init -q \
    && /out/orq-lite init >/dev/null 2>&1 || true
# Shipped example configs (factory_governed / pr_review / issue_fix + their
# roles and prompts). Overlaid onto every project workspace at runtime by
# services/examples_overlay.py so the flows/teams are available by default.
RUN git clone --depth 1 --branch "${ORQ_LITE_VERSION}" \
      https://github.com/lionelchamorro/orquesta-lite /tmp/ol \
    && cp -r /tmp/ol/examples /out/examples \
    && rm -rf /tmp/ol

############################################################
# Stage 2 — build the Next.js frontend
############################################################
FROM node:22-bookworm AS web
WORKDIR /app
# Cap Node heap so `next build` cannot OOM the build host (see repo memory note
# about uncapped Next builds eating ~50GB). Also cap the whole `docker build`
# with a cgroup on the host — see deploy/README.md.
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV NEXT_TELEMETRY_DISABLED=1
# Pin pnpm to the version that generated pnpm-lock.yaml (lockfileVersion 9.0).
# Newer pnpm moved `pnpm.overrides` out of package.json and rejects the frozen
# install with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
# pnpm-workspace.yaml carries the dependency overrides recorded in the
# lockfile; without it the frozen install fails with a config mismatch.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

############################################################
# Stage 3 — runtime (Ubuntu, all-in-one)
############################################################
FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    NEXT_TELEMETRY_DISABLED=1 \
    PIP_NO_CACHE_DIR=1

# Base tools + Python 3.12 (ships on noble) + tini + supervisor + zsh.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git openssh-client ripgrep jq sqlite3 unzip less vim \
      zsh sudo procps locales tini supervisor \
      python3 python3-venv python3-dev \
    && sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI (gh) from GitHub's official apt repo. Required by orq-lite's issue/PR
# watcher (`gh issue list` / `gh pr ...`); without it every watch tick fails and
# the project flips to needs_human. Not in the ubuntu default repos, so add the
# signed source. Auth is provided at runtime (mounted ~/.config/gh or GH_TOKEN).
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 system-wide (NodeSource) — reliable for supervised services and the
# npm-installed agent CLIs (chosen over nvm so non-login shells resolve node).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# uv (Python package manager) system-wide.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# Agent CLIs (global npm). Pin via build args for reproducible rebuilds.
ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
ARG GEMINI_CLI_VERSION=latest
RUN npm install -g --omit=dev \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      @openai/codex@${CODEX_VERSION} \
      @google/gemini-cli@${GEMINI_CLI_VERSION} \
    && npm cache clean --force

# The `ubuntu` user ships at uid/gid 1000 on noble — matches the common host uid
# so bind-mounted credential dirs stay writable (the CLIs rotate OAuth tokens in
# place). Passwordless sudo (interactive convenience + the on-boot self-update,
# which needs root to overwrite /usr/local/bin/orq-lite).
RUN usermod -aG sudo ubuntu && passwd -d ubuntu && chsh -s /usr/bin/zsh ubuntu \
    && printf 'ubuntu ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/90-ubuntu-nopasswd \
    && chmod 0440 /etc/sudoers.d/90-ubuntu-nopasswd

# opencode CLI + oh-my-zsh installed AS the ubuntu user (into its $HOME).
RUN su ubuntu -c 'curl -fsSL https://opencode.ai/install | bash' \
    && su ubuntu -c 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended'

ENV PATH="/home/ubuntu/.opencode/bin:${PATH}"

# Pre-create the XDG dirs owned by ubuntu. Otherwise the runtime bind-mounts of
# ~/.local/share/opencode and ~/.config/opencode make Docker create the
# intermediate .local / .local/share / .config dirs root-owned, and opencode
# (running as ubuntu) can't write ~/.local/state -> EACCES.
RUN mkdir -p /home/ubuntu/.local/share /home/ubuntu/.local/state \
             /home/ubuntu/.local/bin /home/ubuntu/.config /home/ubuntu/.cache \
    && chown -R ubuntu:ubuntu /home/ubuntu/.local /home/ubuntu/.config /home/ubuntu/.cache

# --- application artifacts --------------------------------------------------
# orq-lite binary (spawned per-run by the api's local executor).
COPY --from=orqlite /out/orq-lite /usr/local/bin/orq-lite
COPY --from=orqlite /out/gh /usr/local/bin/gh

# Built frontend (ships its own node_modules so `next start` needs no install).
COPY --from=web --chown=ubuntu:ubuntu /app /app

# Python api: install deps into /srv/api/.venv from the lockfile.
WORKDIR /srv/api
COPY pyproject.toml uv.lock ./
COPY orquesta_api ./orquesta_api
# Alembic config + migrations: main gates startup on the schema being at the
# Alembic head (replaced blind create_all), so these must ship in the image.
COPY alembic.ini ./
COPY alembic ./alembic
RUN uv sync --frozen --no-dev
# Version-matched default configs scaffolded by the release binary (not this
# repo's old fork); seeded into /data on first boot. Prompts + schemas back the
# flow engine's agent steps.
COPY --from=orqlite /out/scaffold/team.json /srv/api/team.json
COPY --from=orqlite /out/scaffold/flows.json /srv/api/flows.json
COPY --from=orqlite /out/scaffold/prompts /srv/api/orq-defaults/prompts
COPY --from=orqlite /out/scaffold/schemas /srv/api/orq-defaults/schemas
COPY --from=orqlite /out/examples /srv/api/orq-examples

# Persistent state: sqlite db, editable team.json, cloned workspaces. Owned by
# ubuntu so a fresh named volume inherits that ownership on first mount.
RUN mkdir -p /data/workspaces && chown -R ubuntu:ubuntu /data

# Process supervisor + entrypoint.
COPY deploy/supervisord.conf /etc/orquesta/supervisord.conf
# opencode chat agent config (MCP bridge + the `orquesta` agent + its prompt).
COPY deploy/opencode.json /etc/orquesta/opencode.json
COPY deploy/orquesta-agent.md /etc/orquesta/orquesta-agent.md
COPY deploy/orquesta-entrypoint.sh /usr/local/bin/orquesta-entrypoint
RUN chmod +x /usr/local/bin/orquesta-entrypoint

# git identity for orq-lite's per-task commits; override via env.
ENV GIT_AUTHOR_NAME=orquesta \
    GIT_AUTHOR_EMAIL=orquesta@local \
    GIT_COMMITTER_NAME=orquesta \
    GIT_COMMITTER_EMAIL=orquesta@local

USER ubuntu
WORKDIR /home/ubuntu
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/orquesta-entrypoint"]
