#!/usr/bin/env bash
# Orquesta all-in-one entrypoint. Seeds the persistent /data volume on first
# boot, then hands off to supervisord (which runs api + opencode + web).
set -euo pipefail

mkdir -p /data/workspaces

# Seed an editable team.json into the volume the first time only. The teams
# router writes back to TEAM_PATH, so it must live on the writable volume, not
# in the read-only image layer.
if [ ! -f /data/team.json ] && [ -f /srv/api/team.json ]; then
  cp /srv/api/team.json /data/team.json
fi

# Seed the default flow-engine flows.json (factory, factory_fast) the first time.
if [ ! -f /data/flows.json ] && [ -f /srv/api/flows.json ]; then
  cp /srv/api/flows.json /data/flows.json
fi

# --- keep orq-lite current ---------------------------------------------------
# Self-update to the latest release on every start. Best-effort and time-boxed
# so an offline start or a slow download can't block boot; needs root (sudo) to
# overwrite /usr/local/bin/orq-lite.
echo "orq-lite: $(orq-lite version 2>/dev/null) — checking for updates…"
if timeout 90 sudo -n orq-lite update 2>&1 | sed 's/^/  orq-lite update: /'; then
  echo "orq-lite: now $(orq-lite version 2>/dev/null)"
else
  echo "  orq-lite update: skipped (offline, already latest, or timed out)"
fi

# --- git auth for cloning private repos --------------------------------------
# The api clones project repos via `git clone`, inheriting this user's global
# git config. Fail fast (no interactive prompt) and trust host keys on first use
# for SSH remotes (writable known_hosts kept outside the read-only ~/.ssh mount).
export GIT_TERMINAL_PROMPT=0
git config --global core.sshCommand \
  "ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/known_hosts"

# HTTPS: inject a GitHub token (the api registers https:// URLs) if provided.
GIT_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -n "$GIT_TOKEN" ]; then
  git config --global \
    url."https://x-access-token:${GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "git: HTTPS GitHub clones authenticated via token"
fi

# --- database schema ---------------------------------------------------------
# main gates startup on the schema being at the Alembic head (ensure_schema_current
# raises otherwise). Upgrade an existing DB, or create a fresh one from the
# migrations, before the API starts.
export DATABASE_URL="${DATABASE_URL:-sqlite+aiosqlite:////data/orquesta_api.db}"
export AUTH_TOKEN="${AUTH_TOKEN:-}"
if ( cd /srv/api && /srv/api/.venv/bin/alembic upgrade head ) 2>&1 | sed 's/^/  alembic: /'; then
  echo "  alembic: schema at head"
else
  echo "  alembic: upgrade failed — the API will report schema status on start"
fi

exec supervisord -c /etc/orquesta/supervisord.conf
