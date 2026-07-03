"""Overlay the bundled orq-lite example flows/teams/prompts onto a workspace.

`orq-lite init` seeds a workspace with the base flows (factory, factory_fast),
the default team and its prompts. This overlays the shipped examples on top so
every project also exposes `factory_governed`, `pr_review` and `issue_fix` —
merging their extra roles/agents and copying their prompt files. Idempotent:
re-running only adds what's missing.
"""

import json
import os
from pathlib import Path
from typing import Any

from orquesta_api.logger import get_logger

logger = get_logger(__name__)

# Baked into the image at build time (see deploy/Dockerfile). Each subdirectory
# is one example: flows.json + team.json + prompts/.
# ast-grep-ignore: settings-module
_EXAMPLES_DIR = os.environ.get("ORQ_EXAMPLES_DIR", "/srv/api/orq-examples")


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text()) if path.exists() else {}


def _write(path: Path, doc: dict[str, Any]) -> None:
    path.write_text(json.dumps(doc, indent=2) + "\n")


def overlay_examples(workspace: str, examples_dir: str | None = None) -> None:
    """Merge every bundled example's flows, roles/agents and prompts into *workspace*.

    No-op when the workspace has no base config yet (init has not run) or when
    the examples bundle is absent.
    """
    root = Path(examples_dir or _EXAMPLES_DIR)
    ws = Path(workspace)
    flows_path = ws / "flows.json"
    team_path = ws / "team.json"
    if not root.is_dir() or not flows_path.exists() or not team_path.exists():
        return

    flows_doc = _load(flows_path)
    team_doc = _load(team_path)
    flows = flows_doc.setdefault("flows", {})
    roles = team_doc.setdefault("roles", {})
    agents = team_doc.setdefault("agents", {})
    prompts_dir = ws / "prompts"
    added: list[str] = []
    changed = False

    for example in sorted(p for p in root.iterdir() if p.is_dir()):
        for name, flow in _load(example / "flows.json").get("flows", {}).items():
            if name not in flows:
                flows[name] = flow
                added.append(name)
                changed = True
        ex_team = _load(example / "team.json")
        for name, role in ex_team.get("roles", {}).items():
            if name not in roles:
                roles[name] = role
                changed = True
        for name, agent in ex_team.get("agents", {}).items():
            if name not in agents:
                agents[name] = agent
                changed = True
        ex_prompts = example / "prompts"
        if ex_prompts.is_dir():
            prompts_dir.mkdir(exist_ok=True)
            for prompt in ex_prompts.glob("*.md"):
                dest = prompts_dir / prompt.name
                if not dest.exists():
                    dest.write_text(prompt.read_text())

    # Only rewrite the user-owned config when we actually added something, so we
    # don't churn their formatting on every run.
    if changed:
        _write(flows_path, flows_doc)
        _write(team_path, team_doc)
        logger.info("Overlaid example flows => workspace=%s added=%s", workspace, added)
