# syntax=docker/dockerfile:1
#
# Multi-stage build for orquesta: an `api` image (FastAPI control plane +
# the orq-lite binary it supervises) and a `web` image (Next.js console).
# Build one or the other with `--target api` / `--target web`; see
# docker-compose.yml for the two-service wiring.

# ---------------------------------------------------------------------------
# orq-lite: built from source and pinned by version tag. Go module downloads
# are content-addressed once resolved (go.sum pins the exact commit), so a
# tag pin here is as reproducible as pinning a release sha would be — there
# is no separate binary release artifact to pin against instead.
# ---------------------------------------------------------------------------
FROM golang:1.24-alpine AS orq-lite
ARG ORQ_LITE_VERSION=v0.2.0
RUN apk add --no-cache git \
    && go install "github.com/lionelchamorro/orquestalite/cmd/orq-lite@${ORQ_LITE_VERSION}"

# ---------------------------------------------------------------------------
# web: Next.js standalone build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS web-build
WORKDIR /app
RUN corepack enable
COPY --from=web-deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S orquesta && adduser -S orquesta -G orquesta
COPY --from=web-build /app/public ./public
COPY --from=web-build --chown=orquesta:orquesta /app/.next/standalone ./
COPY --from=web-build --chown=orquesta:orquesta /app/.next/static ./.next/static
USER orquesta
EXPOSE 3000
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# api: FastAPI control plane + the orq-lite binary it shells out to
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS api
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin orquesta

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /usr/local/bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:${PATH}"

COPY orquesta_api ./orquesta_api
COPY alembic ./alembic
COPY alembic.ini ./
COPY --from=orq-lite /go/bin/orq-lite /usr/local/bin/orq-lite

ENV ORQ_LITE_BIN=/usr/local/bin/orq-lite \
    WORKSPACES_DIR=/data/workspaces \
    DATABASE_URL=sqlite+aiosqlite:////data/orquesta_api.db

RUN mkdir -p /data/workspaces && chown -R orquesta:orquesta /data /app
USER orquesta

EXPOSE 8000
CMD alembic upgrade head && uvicorn orquesta_api.main:create_app --factory --host 0.0.0.0 --port 8000
