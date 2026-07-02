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

# Seed default flows (real orq-lite verbs: factory / run / plan) the first time.
if [ ! -f /data/flows.json ] && [ -f /srv/api/flows.json ]; then
  cp /srv/api/flows.json /data/flows.json
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

exec supervisord -c /etc/orquesta/supervisord.conf
