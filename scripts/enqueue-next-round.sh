#!/bin/sh
# Enqueue the next factory_governed round when the post-delivery audit found
# priority-1 defects. Called by the factory_governed flow as its final step:
#
#   sh scripts/enqueue-next-round.sh <audit_round> <base_branch> <work_branch>
#
# Safe by default — it exits 0 without enqueueing unless ALL hold:
#   * .orquestalite/results/auditor.json exists with p1_count > 0
#   * audit_round < ORQUESTA_MAX_AUDIT_ROUNDS (default 2)
#   * ORQUESTA_URL and ORQUESTA_PROJECT_ID are set in the environment
# Without the env vars this is a human-gated no-op: the auditor's
# .scratch/features-next.md is ready and the operator launches round N+1.
set -eu

AUDIT_ROUND="${1:?usage: enqueue-next-round.sh <audit_round> <base_branch> <work_branch>}"
BASE_BRANCH="${2:?missing base_branch}"
WORK_BRANCH="${3:?missing work_branch}"
MAX_ROUNDS="${ORQUESTA_MAX_AUDIT_ROUNDS:-2}"
RESULT=".orquestalite/results/auditor.json"
FEATURES_NEXT=".scratch/features-next.md"

if [ ! -f "$RESULT" ]; then
    echo "enqueue-next-round: no auditor result at $RESULT, nothing to do"
    exit 0
fi

P1_COUNT="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('p1_count', 0))" "$RESULT")"

if [ "$P1_COUNT" -eq 0 ]; then
    echo "enqueue-next-round: audit clean (p1_count=0), no next round"
    exit 0
fi

if [ "$AUDIT_ROUND" -ge "$MAX_ROUNDS" ]; then
    echo "enqueue-next-round: audit_round=$AUDIT_ROUND reached cap $MAX_ROUNDS; leaving $P1_COUNT P1 finding(s) for a human (see $FEATURES_NEXT)"
    exit 0
fi

if [ ! -f "$FEATURES_NEXT" ]; then
    echo "enqueue-next-round: auditor reported P1s but $FEATURES_NEXT is missing; leaving for a human"
    exit 0
fi

if [ -z "${ORQUESTA_URL:-}" ] || [ -z "${ORQUESTA_PROJECT_ID:-}" ]; then
    echo "enqueue-next-round: $P1_COUNT P1 finding(s); next-round features ready at $FEATURES_NEXT."
    echo "enqueue-next-round: set ORQUESTA_URL and ORQUESTA_PROJECT_ID to auto-enqueue, or launch manually:"
    echo "  orq-lite flow run factory_governed features_path=$FEATURES_NEXT base_branch=$BASE_BRANCH work_branch=$WORK_BRANCH audit_round=$((AUDIT_ROUND + 1))"
    exit 0
fi

PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT
python3 - "$FEATURES_NEXT" "$BASE_BRANCH" "$WORK_BRANCH" "$((AUDIT_ROUND + 1))" >"$PAYLOAD" <<'PY'
import json
import sys

features, base, work, nxt = sys.argv[1:5]
print(
    json.dumps(
        {
            "kind": "flow",
            "flow": "factory_governed",
            "queue": True,
            "inputs": {
                "features_path": features,
                "base_branch": base,
                "work_branch": work,
                "audit_round": nxt,
            },
        }
    )
)
PY

echo "enqueue-next-round: enqueueing audit round $((AUDIT_ROUND + 1)) ($P1_COUNT P1 findings) via $ORQUESTA_URL"
curl -fsS -X POST "$ORQUESTA_URL/projects/$ORQUESTA_PROJECT_ID/runs" \
    -H 'content-type: application/json' \
    -d @"$PAYLOAD"
echo
echo "enqueue-next-round: enqueued"
