#!/usr/bin/env bash
set -euo pipefail

ORQ_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_CWD="${ORQ_CWD:-$PWD}"

if [[ ! -d "$TARGET_CWD" ]]; then
  echo "[dev] ORQ_CWD does not exist: $TARGET_CWD" >&2
  exit 1
fi

PORT="${ORQ_PORT:-8000}"
UI_PORT="${ORQ_UI_PORT:-4173}"

pids=()

cleanup() {
  echo ""
  echo "[dev] shutting down..."
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] repo    → $ORQ_REPO"
echo "[dev] target  → $TARGET_CWD"
echo "[dev] daemon  → http://localhost:${PORT}"
echo "[dev] ui      → http://localhost:${UI_PORT}"
echo ""

(
  cd "$TARGET_CWD"
  ORQ_PORT="$PORT" bun run --watch "$ORQ_REPO/src/daemon/index.ts" 2>&1 | sed -l 's/^/[daemon] /'
) &
pids+=($!)

(
  cd "$ORQ_REPO"
  bunx vite --port "$UI_PORT" 2>&1 | sed -l 's/^/[ui]     /'
) &
pids+=($!)

while :; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      exit 1
    fi
  done
  sleep 1
done
