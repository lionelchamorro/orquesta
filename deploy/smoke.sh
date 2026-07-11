#!/usr/bin/env bash
# Smoke test for the all-in-one container. Runs AFTER `docker compose up -d`
# against the only exposed port (the frontend); everything flows through same-origin proxies,
# just like a real browser.
#
#   ./smoke.sh                         # infrastructure + flows checks
#   SMOKE_CHAT=1 ./smoke.sh            # + a real chat turn with the agent
#   SMOKE_REPO_URL=https://... ./smoke.sh   # + register a test project
set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://127.0.0.1:3000}"
FAILURES=0

say()  { printf '\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

wait_for() { # url name [tries]
  local url=$1 name=$2 tries=${3:-60}
  for _ in $(seq "$tries"); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then ok "$name responding"; return 0; fi
    sleep 2
  done
  fail "$name did not respond after $((tries * 2))s ($url)"
  return 1
}

say "frontend"
wait_for "$BASE" "next" || exit 1

say "system status (api + opencode + mcp up)"
status=$(curl -fsS -m 5 "$BASE/api/system-status")
echo "  $status"
for svc in api opencode mcp; do
  if [ "$(echo "$status" | jq -r ".$svc")" = "up" ]; then ok "$svc up"; else fail "$svc down"; fi
done

say "control plane via proxy"
projects=$(curl -fsS -m 5 "$BASE/api/control-plane/projects")
if echo "$projects" | jq -e 'type == "array"' >/dev/null; then
  ok "GET /projects → array of $(echo "$projects" | jq length)"
else
  fail "GET /projects did not return an array"
fi

say "opencode via proxy"
if curl -fsS -m 5 "$BASE/opencode/config" >/dev/null; then ok "GET /opencode/config"; else fail "GET /opencode/config"; fi

say "SSE events (stream opens and keeps alive or delivers data)"
if timeout 5 curl -fsSN -m 5 "$BASE/api/control-plane/events" -o /dev/null 2>/dev/null; then
  ok "SSE opened and closed cleanly"
else
  # timeout(1) cuts the open connection: exit 124 means the stream is ALIVE.
  rc=$?
  if [ "$rc" = "124" ]; then ok "SSE stays open (expected timeout)"; else fail "SSE does not connect (rc=$rc)"; fi
fi

say "flows round-trip (if there's at least one project)"
first_project=$(echo "$projects" | jq -r '.[0].id // empty')
if [ -n "$first_project" ]; then
  flows=$(curl -fsS -m 5 "$BASE/api/control-plane/projects/$first_project/flows")
  first_flow=$(echo "$flows" | jq -c '.[0] // empty')
  if [ -n "$first_flow" ]; then
    flow_id=$(echo "$first_flow" | jq -r '.id')
    code=$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' -X PUT \
      -H 'Content-Type: application/json' -d "$first_flow" \
      "$BASE/api/control-plane/projects/$first_project/flows/$flow_id")
    if [ "$code" = "200" ]; then ok "PUT flow '$flow_id' (round-trip without changes) → 200"; else fail "PUT flow → $code"; fi
  else
    ok "project has no flows — skipped"
  fi
else
  ok "no projects registered — skipped (set SMOKE_REPO_URL to test registration)"
fi

if [ -n "${SMOKE_REPO_URL:-}" ]; then
  say "test project registration"
  created=$(curl -fsS -m 60 -X POST -H 'Content-Type: application/json' \
    -d "{\"name\": \"smoke-$(date +%s)\", \"repo_url\": \"$SMOKE_REPO_URL\", \"base_branch\": \"main\"}" \
    "$BASE/api/control-plane/projects")
  pid=$(echo "$created" | jq -r '.id // empty')
  if [ -n "$pid" ]; then ok "project registered: $pid"; else fail "registration failed: $created"; fi
fi

if [ "${SMOKE_CHAT:-0}" = "1" ]; then
  say "real chat turn (orquesta agent + MCP tools)"
  sid=$(curl -fsS -m 10 -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/opencode/session" | jq -r '.id')
  reply=$(curl -fsS -m 120 -X POST -H 'Content-Type: application/json' \
    -d '{"agent": "orquesta", "parts": [{"type": "text", "text": "List my projects"}]}' \
    "$BASE/opencode/session/$sid/message")
  if echo "$reply" | jq -e '.parts | length > 0' >/dev/null 2>&1; then
    ok "agent responded ($(echo "$reply" | jq '[.parts[] | select(.type == "tool")] | length') tool calls)"
  else
    fail "agent did not respond: $(echo "$reply" | head -c 200)"
  fi
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  printf '\033[31m%d check(s) failed\033[0m\n' "$FAILURES"
  exit 1
fi
printf '\033[32mall checks passed\033[0m\n'
