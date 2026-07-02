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
ARG ORQ_LITE_VERSION=v0.1.26
ARG ORQ_LITE_SHA256=d69596f1625decda3ecf747df5e5cdde881a7bd4195fa282874ff5e7dd8ea1ec
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
# Real default configs, pinned to the same tag (the flow engine loads flows.json
# from the working dir; the shipped flows are NOT embedded in the binary).
RUN curl -fsSL -o /out/flows.json "https://raw.githubusercontent.com/lionelchamorro/orquesta-lite/${ORQ_LITE_VERSION}/flows.json" \
    && curl -fsSL -o /out/team.json "https://raw.githubusercontent.com/lionelchamorro/orquesta-lite/${ORQ_LITE_VERSION}/team.json"
# Version-matched prompts + result schemas from the binary's own scaffolder
# (embedded); a flow's agent steps read prompts/<role>.md relative to the cwd.
RUN mkdir -p /out/scaffold && cd /out/scaffold && git init -q \
    && /out/orq-lite init >/dev/null 2>&1 || true

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
COPY package.json pnpm-lock.yaml ./
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
# place). Give it passwordless sudo for interactive convenience.
RUN usermod -aG sudo ubuntu && passwd -d ubuntu && chsh -s /usr/bin/zsh ubuntu

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

# Built frontend (ships its own node_modules so `next start` needs no install).
COPY --from=web --chown=ubuntu:ubuntu /app /app

# Python api: install deps into /srv/api/.venv from the lockfile.
WORKDIR /srv/api
COPY pyproject.toml uv.lock ./
COPY orquesta_api ./orquesta_api
RUN uv sync --frozen --no-dev
# Real, version-matched default configs (from the release, not this repo's old
# fork); seeded into /data on first boot. Prompts + schemas back the flow
# engine's agent steps.
COPY --from=orqlite /out/team.json /srv/api/team.json
COPY --from=orqlite /out/flows.json /srv/api/flows.json
COPY --from=orqlite /out/scaffold/prompts /srv/api/orq-defaults/prompts
COPY --from=orqlite /out/scaffold/schemas /srv/api/orq-defaults/schemas

# Persistent state: sqlite db, editable team.json, cloned workspaces. Owned by
# ubuntu so a fresh named volume inherits that ownership on first mount.
RUN mkdir -p /data/workspaces && chown -R ubuntu:ubuntu /data

# Process supervisor + entrypoint.
COPY deploy/supervisord.conf /etc/orquesta/supervisord.conf
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
