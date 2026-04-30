#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="${ORQ_TEST_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
TARGET_DIR="${ORQ_TEST_DIR:-/tmp/orq-${RUN_ID}}"
PORT="${ORQ_PORT:-8010}"
TIMEOUT_SECONDS="${ORQ_TEST_TIMEOUT_SECONDS:-3600}"
HEARTBEAT_SECONDS="${ORQ_TEST_HEARTBEAT_SECONDS:-30}"
PROMPT="${*:-implement a golang api that mimics anthropic api}"

DAEMON_PID=""

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[test] missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${DAEMON_PID}" ]] && kill -0 "${DAEMON_PID}" 2>/dev/null; then
    echo "[test] stopping daemon pid=${DAEMON_PID}"
    kill "${DAEMON_PID}" 2>/dev/null || true
    wait "${DAEMON_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

need bun
need curl
need jq
need git

mkdir -p "${TARGET_DIR}"
if ! git -C "${TARGET_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git -C "${TARGET_DIR}" init -b main >/dev/null 2>&1; then
    git -C "${TARGET_DIR}" init >/dev/null
    git -C "${TARGET_DIR}" checkout -B main >/dev/null
  fi
  git -C "${TARGET_DIR}" -c user.name="Orquesta Smoke Test" -c user.email="orquesta-smoke@example.invalid" commit --allow-empty -m "Initial smoke-test commit" >/dev/null
fi

echo "[test] repo:   ${REPO_ROOT}"
echo "[test] target: ${TARGET_DIR}"
echo "[test] port:   ${PORT}"
echo "[test] prompt: ${PROMPT}"
echo ""

(
  cd "${TARGET_DIR}"
  ORQ_PORT="${PORT}" bun run "${REPO_ROOT}/src/daemon/index.ts"
) >"${TARGET_DIR}/daemon.log" 2>&1 &
DAEMON_PID="$!"

echo "[test] daemon pid=${DAEMON_PID}"
echo "[test] daemon log: ${TARGET_DIR}/daemon.log"

for _ in $(seq 1 100); do
  if ! kill -0 "${DAEMON_PID}" 2>/dev/null; then
    echo "[test] daemon exited before becoming healthy" >&2
    tail -80 "${TARGET_DIR}/daemon.log" >&2 || true
    exit 1
  fi
  if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo "[test] health:"
curl -fsS "http://localhost:${PORT}/api/health" | jq

echo ""
echo "[test] starting planner"
(
  cd "${TARGET_DIR}"
  ORQ_PORT="${PORT}" bun run "${REPO_ROOT}/src/cli/orq.ts" plan "${PROMPT}"
)

echo ""
echo "[test] waiting for planner to emit tasks"
for _ in $(seq 1 240); do
  STATE="$(curl -fsS "http://localhost:${PORT}/api/runs/current")"
  STATUS="$(jq -r '.plan.status' <<<"${STATE}")"
  TASK_COUNT="$(jq -r '.tasks | length' <<<"${STATE}")"
  AGENTS="$(jq -r '[.agents[] | "\(.role):\(.status)"] | join(", ")' <<<"${STATE}")"
  echo "[test] planner status=${STATUS} tasks=${TASK_COUNT} agents=[${AGENTS}]"
  if [[ "${STATUS}" == "awaiting_approval" && "${TASK_COUNT}" -gt 0 ]]; then
    break
  fi
  if [[ "${STATUS}" == "drafting" ]]; then
    sleep 0.5
  else
    sleep 2
  fi
done

echo ""
echo "[test] plan:"
curl -fsS "http://localhost:${PORT}/api/runs/current" | jq '.plan'

echo ""
echo "[test] tasks:"
curl -fsS "http://localhost:${PORT}/api/runs/current" \
  | jq '.tasks[] | {id, status, title}'

TOKEN="$(cat "${TARGET_DIR}/.orquesta/crew/session.token")"

echo ""
echo "[test] approving via daemon API"
curl -fsS -X POST "http://localhost:${PORT}/api/approve" \
  -H "x-orquesta-token: ${TOKEN}" \
  | jq

STARTED_AT="$(date +%s)"
LAST_SUMMARY=""
LAST_HEARTBEAT="${STARTED_AT}"

echo ""
echo "[test] monitoring run"
while kill -0 "${DAEMON_PID}" 2>/dev/null; do
  NOW="$(date +%s)"
  if (( NOW - STARTED_AT > TIMEOUT_SECONDS )); then
    echo "[test] timeout after ${TIMEOUT_SECONDS}s"
    exit 124
  fi

  STATE="$(curl -fsS "http://localhost:${PORT}/api/runs/current")"
  STATUS="$(jq -r '.plan.status' <<<"${STATE}")"
  SUMMARY="$(jq -r '
    "plan=\(.plan.status) completed=\(.plan.completed_count)/\(.plan.task_count)",
    ([.tasks[] | "\(.id):\(.status)"] | join(" ")),
    ([.agents[] | "\(.role):\(.status):\(.id[0:8])"] | join(" "))
  ' <<<"${STATE}")"
  EVENT_STATE="$(curl -fsS "http://localhost:${PORT}/api/export")"

  if [[ "${SUMMARY}" != "${LAST_SUMMARY}" ]]; then
    echo "----- $(date -u +%Y-%m-%dT%H:%M:%SZ) -----"
    echo "${SUMMARY}"
    echo "[test] recent events:"
    jq -r '.events[-8:][]? |
      (.payload.message // .payload.summary // .payload.chunk // .payload.reason // "") as $msg |
      "\(.journal_id // "-") \(.ts) \(.payload.type) \(.tags | join(",")) \($msg | tostring | gsub("[\r\n\t]+"; " ") | .[0:120])"' <<<"${EVENT_STATE}"
    LAST_SUMMARY="${SUMMARY}"
    LAST_HEARTBEAT="${NOW}"
  elif (( NOW - LAST_HEARTBEAT >= HEARTBEAT_SECONDS )); then
    EVENT_COUNT="$(jq -r '.events | length' <<<"${EVENT_STATE}")"
    LATEST_ACTIVITY="$(jq -r '[.events[] | select(.payload.type == "activity") | .payload.message] | last // ""' <<<"${EVENT_STATE}")"
    TASKS="$(jq -r '[.tasks[] | "\(.id)=\(.status)"] | join(" ")' <<<"${STATE}")"
    echo "[test] heartbeat $(date -u +%H:%M:%SZ) plan=${STATUS} events=${EVENT_COUNT} ${TASKS} ${LATEST_ACTIVITY}"
    LAST_HEARTBEAT="${NOW}"
  fi

  if [[ "${STATUS}" == "done" || "${STATUS}" == "failed" ]]; then
    echo "[test] final status=${STATUS}"
    break
  fi

  sleep 3
done

echo ""
echo "[test] final state:"
curl -fsS "http://localhost:${PORT}/api/runs/current" \
  | jq '{plan: .plan, tasks: [.tasks[] | {id, status, title}], agents: [.agents[] | {id, role, status, bound_task, bound_subtask}]}'

echo ""
echo "[test] files:"
find "${TARGET_DIR}/.orquesta/crew" -maxdepth 3 -type f | sort
