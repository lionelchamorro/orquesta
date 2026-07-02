"""Read and write orq-lite config files exposed by the control-plane API."""

import json
from pathlib import Path
from typing import Any

from orquesta_api.config import settings
from orquesta_api.meta.models import (
    AgentDefinition,
    FlowDefinition,
    FlowStep,
    TeamDefinition,
    TeamLimits,
    TeamRoleDefinition,
)


def _config_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return Path.cwd() / path


def _read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    with path.open() as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        return fallback
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")


class FlowConfigStore:
    """Store backed by flows.json, the file consumed by `orq-lite flow run`."""

    def __init__(self, path: str | None = None) -> None:
        self.path = _config_path(path or settings.flows_path)

    def list(self) -> list[FlowDefinition]:
        document = _read_json(self.path, {"flows": {}})
        raw_flows = document.get("flows", {})
        if isinstance(raw_flows, list):
            items = [(str(item.get("id", index)), item) for index, item in enumerate(raw_flows)]
        elif isinstance(raw_flows, dict):
            items = list(raw_flows.items())
        else:
            items = []
        return [
            self._normalise_flow(flow_id, raw) for flow_id, raw in items if isinstance(raw, dict)
        ]

    def upsert(self, flow_id: str, flow: FlowDefinition) -> FlowDefinition:
        document = _read_json(self.path, {"flows": {}})
        flows = document.setdefault("flows", {})
        if not isinstance(flows, dict):
            flows = {}
            document["flows"] = flows
        saved = flow.model_copy(update={"id": flow_id, "source": "orquesta-api"})
        flows[flow_id] = self._dump_flow(saved)
        _write_json(self.path, document)
        return saved

    def delete(self, flow_id: str) -> None:
        document = _read_json(self.path, {"flows": {}})
        flows = document.get("flows", {})
        if isinstance(flows, dict):
            flows.pop(flow_id, None)
        _write_json(self.path, document)

    def _normalise_flow(self, flow_id: str, raw: dict[str, Any]) -> FlowDefinition:
        steps = raw.get("steps", [])
        normalised_steps = []
        if isinstance(steps, list):
            for index, step in enumerate(steps):
                if not isinstance(step, dict):
                    continue
                normalised_steps.append(
                    FlowStep(
                        id=str(step.get("id") or f"step-{index + 1}"),
                        label=str(step.get("label") or step.get("id") or f"Step {index + 1}"),
                        command=str(step.get("command") or raw.get("command") or "orq-lite"),
                        args=[str(arg) for arg in step.get("args", raw.get("args", []))],
                        role=step.get("role"),
                        depends_on=[str(dep) for dep in step.get("depends_on", [])],
                        description=step.get("description"),
                    )
                )
        variables = raw.get("variables", {}) if isinstance(raw.get("variables", {}), dict) else {}
        tags = raw.get("tags", []) if isinstance(raw.get("tags", []), list) else []
        return FlowDefinition(
            id=str(raw.get("id") or flow_id),
            name=str(raw.get("name") or flow_id),
            description=str(raw.get("description") or "Configured orq-lite flow"),
            team_id=str(raw.get("team_id") or raw.get("team") or "default"),
            entrypoint=str(raw.get("entrypoint") or f"orq-lite flow run {flow_id}"),
            variables={str(key): str(value) for key, value in variables.items()},
            steps=normalised_steps,
            tags=[str(tag) for tag in tags],
            source="orquesta-api",
        )

    def _dump_flow(self, flow: FlowDefinition) -> dict[str, Any]:
        return flow.model_dump(exclude={"source"}, exclude_none=True)


class TeamConfigStore:
    """Store backed by team.json, the roster consumed by orq-lite."""

    def __init__(self, path: str | None = None) -> None:
        self.path = _config_path(path or settings.team_path)

    def list(self) -> list[TeamDefinition]:
        return [self.get("default")]

    def get(self, team_id: str) -> TeamDefinition:
        if team_id != "default":
            raise ValueError(f"Team '{team_id}' not found")
        raw = _read_json(self.path, {})
        return self._normalise_team(raw)

    def update(self, team_id: str, team: TeamDefinition) -> TeamDefinition:
        if team_id != "default":
            raise ValueError("orq-lite currently reads a single team.json; use team id 'default'")
        saved = team.model_copy(update={"id": "default", "source": "orquesta-api"})
        _write_json(self.path, self._dump_team(saved))
        return saved

    def _normalise_team(self, raw: dict[str, Any]) -> TeamDefinition:
        agents_raw = raw.get("agents", {}) if isinstance(raw.get("agents", {}), dict) else {}
        roles_raw = raw.get("roles", {}) if isinstance(raw.get("roles", {}), dict) else {}
        agents = [
            AgentDefinition(
                id=name,
                provider=str(agent.get("provider") or "cmd"),
                model=agent.get("model"),
                effort=agent.get("effort"),
                cmd=agent.get("cmd"),
                dangerously_skip_permissions=agent.get("dangerously_skip_permissions"),
                rate_limit_pattern=agent.get("rate_limit_pattern"),
            )
            for name, agent in agents_raw.items()
            if isinstance(agent, dict)
        ]
        roles = [
            TeamRoleDefinition(
                role=name,
                agents=[str(agent) for agent in role.get("agents", [])],
                prompt=str(role.get("prompt") or f"prompts/{name}.md"),
                result_path=str(role.get("result_path") or f".orquestalite/results/{name}.json"),
                timeout_seconds=int(role.get("timeout_seconds") or 600),
                escalation_ladder=role.get("escalation_ladder"),
                decompose_prompt=role.get("decompose_prompt"),
                mode=role.get("mode"),
                cycle_prompt=role.get("cycle_prompt"),
            )
            for name, role in roles_raw.items()
            if isinstance(role, dict)
        ]
        return TeamDefinition(
            id="default",
            name=str(raw.get("name") or "Default delivery team"),
            description=str(raw.get("description") or "orq-lite team.json roster"),
            agents=agents,
            roles=roles,
            limits=TeamLimits(**raw.get("limits", {}))
            if isinstance(raw.get("limits", {}), dict)
            else TeamLimits(),
            full_test_command=str(raw.get("full_test_command") or ""),
            lint_command=raw.get("lint_command") or "",
            conventions_file=raw.get("conventions_file"),
            source="orquesta-api",
        )

    def _dump_team(self, team: TeamDefinition) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "agents": {},
            "roles": {},
            "limits": team.limits.model_dump(exclude_none=True),
            "full_test_command": team.full_test_command,
            "lint_command": team.lint_command or "",
        }
        if team.conventions_file:
            payload["conventions_file"] = team.conventions_file
        for agent in team.agents:
            data = agent.model_dump(exclude={"id"}, exclude_none=True)
            payload["agents"][agent.id] = data
        for role in team.roles:
            data = role.model_dump(exclude={"role"}, exclude_none=True)
            payload["roles"][role.role] = data
        return payload
