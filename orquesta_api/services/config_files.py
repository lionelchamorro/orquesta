"""Read and write orq-lite config files exposed by the control-plane API.

Both stores use a raw-dict read-modify-write strategy on the write path so that
fields the Python model does not know about (e.g. ``rate_limit_backoff``,
``limits.preflight_enabled``) are preserved when a partial patch is saved.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from orquesta_api.meta.models import (
    AgentDefinition,
    FlowDefinition,
    FlowInputSpec,
    FlowStep,
    StepType,
    TeamDefinition,
    TeamLimits,
    TeamRoleDefinition,
)

_KNOWN_STEP_TYPES = {member.value for member in StepType}


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


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Merge *patch* onto *base*, returning a new dict.

    Rules:
    - Keys in *base* that are absent from *patch* are preserved unchanged.
    - If both ``base[key]`` and ``patch[key]`` are plain :class:`dict` instances
      the merge recurses into them.
    - For all other types (including :class:`list`) the patch value wins
      outright — lists are replaced wholesale, never merged element-wise.
    """
    result = dict(base)
    for key, patch_value in patch.items():
        if key in result and isinstance(result[key], dict) and isinstance(patch_value, dict):
            result[key] = _deep_merge(result[key], patch_value)
        else:
            result[key] = patch_value
    return result


class FlowConfigStore:
    """Store backed by ``flows.json``, the file consumed by ``orq-lite flow run``."""

    def __init__(self, workspace: Path) -> None:
        self.path = workspace / "flows.json"

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

    def upsert(self, flow_id: str, patch: dict[str, Any]) -> FlowDefinition:
        """Deep-merge *patch* onto the existing flow entry and write back.

        The top-level ``flows`` document is preserved; only the entry for
        *flow_id* is updated.  Unknown fields within that entry survive the
        merge.
        """
        document = _read_json(self.path, {"flows": {}})
        flows = document.setdefault("flows", {})
        if not isinstance(flows, dict):
            flows = {}
            document["flows"] = flows

        existing = flows.get(flow_id, {}) if isinstance(flows.get(flow_id), dict) else {}
        merged = _deep_merge(existing, patch)
        flows[flow_id] = merged
        _write_json(self.path, document)
        return self._normalise_flow(flow_id, merged)

    def delete(self, flow_id: str) -> None:
        document = _read_json(self.path, {"flows": {}})
        flows = document.get("flows", {})
        if isinstance(flows, dict):
            flows.pop(flow_id, None)
        _write_json(self.path, document)

    def _normalise_flow(self, flow_id: str, raw: dict[str, Any]) -> FlowDefinition:
        steps = raw.get("steps", [])
        normalised_steps = self._normalise_steps(steps) if isinstance(steps, list) else []
        inputs_raw = raw.get("inputs", {}) if isinstance(raw.get("inputs", {}), dict) else {}
        inputs = {
            str(name): FlowInputSpec(type=spec.get("type"), default=spec.get("default"))
            for name, spec in inputs_raw.items()
            if isinstance(spec, dict)
        }
        return FlowDefinition(
            id=flow_id,
            name=str(raw.get("name") or flow_id),
            description=str(raw.get("description") or ""),
            entrypoint=f"orq-lite flow run {flow_id}",
            inputs=inputs,
            steps=normalised_steps,
            source="orquesta-api",
        )

    def _normalise_steps(self, steps: list[Any]) -> list[FlowStep]:
        normalised: list[FlowStep] = []
        for step in steps:
            if not isinstance(step, dict):
                continue
            step_type = step.get("type")
            if step_type not in _KNOWN_STEP_TYPES:
                # Legacy shape (Task 5 and earlier) had no `type`; every step was
                # an implicit CLI command invocation.
                step_type = StepType.command.value
            body = step.get("body")
            normalised.append(
                FlowStep(
                    type=StepType(step_type),
                    agent=step.get("agent"),
                    command=step.get("command"),
                    args=[str(arg) for arg in step["args"]]
                    if isinstance(step.get("args"), list)
                    else None,
                    action=step.get("action"),
                    inputs=step.get("inputs") if isinstance(step.get("inputs"), dict) else None,
                    outputs=step.get("outputs") if isinstance(step.get("outputs"), dict) else None,
                    iterator=step.get("iterator"),
                    **{"as": step.get("as")},
                    body=self._normalise_steps(body) if isinstance(body, list) else None,
                    condition=step.get("condition"),
                    max_retries=step.get("max_retries"),
                    expression=step.get("expression"),
                    on_failure=step.get("on_failure") or None,
                )
            )
        return normalised


class TeamConfigStore:
    """Store backed by ``team.json``, the roster consumed by orq-lite."""

    def __init__(self, workspace: Path) -> None:
        self.path = workspace / "team.json"

    def list(self) -> list[TeamDefinition]:
        return [self.get("default")]

    def get(self, team_id: str) -> TeamDefinition:
        if team_id != "default":
            raise ValueError(f"Team '{team_id}' not found")
        raw = _read_json(self.path, {})
        return self._normalise_team(raw)

    def update(self, patch: dict[str, Any]) -> TeamDefinition:
        """Deep-merge *patch* onto the raw ``team.json`` dict and write back.

        Fields present in the file but absent from *patch* (such as
        ``rate_limit_backoff``) are preserved verbatim.  The merged raw dict is
        then normalised into a :class:`TeamDefinition` for the API response.
        """
        raw = _read_json(self.path, {})
        merged = _deep_merge(raw, patch)
        _write_json(self.path, merged)
        return self._normalise_team(merged)

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
