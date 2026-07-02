"""Task 19: Pydantic <-> lib/types.ts field-name contract.

Every model in orquesta_api.meta.models that is also exposed to the
frontend must declare the same field names as its lib/types.ts mirror,
per CLAUDE.md's "Los modelos Pydantic espejan lib/types.ts campo por
campo" rule. This re-implements scripts/gen-ts-contract.ts's brace-depth
interface extraction directly in Python so the check runs without Node.

Models that exist only on one side (e.g. Repo/Run/RunSpec are backend-
internal, never exposed as a typed TS interface) are intentionally not
in MIRRORED_MODELS below.
"""

import re
from pathlib import Path

from orquesta_api.meta.models import (
    AgentDefinition,
    ChatMessage,
    Feature,
    FlowDefinition,
    FlowInputSpec,
    FlowStep,
    Project,
    RunEvent,
    Task,
    TeamDefinition,
    TeamLimits,
    TeamRoleDefinition,
)

_TYPES_TS = Path(__file__).resolve().parents[1] / "lib" / "types.ts"

# ts_interface_name -> (PydanticModel, {python_field_name: ts_field_name, ...})
# The rename map covers deliberate, documented differences only (e.g. `as` is
# a Python keyword, so FlowStep aliases it to `as_`).
MIRRORED_MODELS: dict[str, tuple[type, dict[str, str]]] = {
    "Task": (Task, {}),
    "Feature": (Feature, {}),
    "RunEvent": (RunEvent, {}),
    "Project": (Project, {}),
    "ChatMessage": (ChatMessage, {}),
    "AgentDefinition": (AgentDefinition, {}),
    "TeamRoleDefinition": (TeamRoleDefinition, {}),
    "TeamLimits": (TeamLimits, {}),
    "TeamDefinition": (TeamDefinition, {}),
    "FlowStep": (FlowStep, {"as_": "as"}),
    "FlowInputSpec": (FlowInputSpec, {}),
    "FlowDefinition": (FlowDefinition, {}),
}

# TS fields with no Pydantic counterpart, for a documented reason (not a gap).
ALLOWED_EXTRA_TS_FIELDS: dict[str, set[str]] = {
    # run_id arrives via RunEvent's extra="allow" passthrough (Task 7): real
    # orq-lite events carry it once a run has a logger, but it is not a
    # formal field on the model.
    "RunEvent": {"run_id"},
}


def _extract_ts_interfaces(source: str) -> dict[str, list[str]]:
    """Brace-depth extraction of `export interface Name { field: T; ... }` blocks."""
    result: dict[str, list[str]] = {}
    current: str | None = None
    depth = 0

    for raw_line in source.splitlines():
        line = raw_line.strip()

        if current is None:
            match = re.match(r"^export interface (\w+)\s*\{", line)
            if match:
                current = match.group(1)
                result[current] = []
                depth = 1
            continue

        depth += line.count("{") - line.count("}")
        if depth <= 0:
            current = None
            continue

        if depth == 1:
            field_match = re.match(r"^(\w+)\??:", line)
            if field_match:
                result[current].append(field_match.group(1))

    return result


def test_every_mirrored_ts_interface_exists() -> None:
    ts_interfaces = _extract_ts_interfaces(_TYPES_TS.read_text())
    missing = set(MIRRORED_MODELS) - set(ts_interfaces)
    assert not missing, f"lib/types.ts is missing interfaces: {sorted(missing)}"


def test_pydantic_and_typescript_fields_match() -> None:
    ts_interfaces = _extract_ts_interfaces(_TYPES_TS.read_text())
    mismatches: list[str] = []

    for ts_name, (model, renames) in MIRRORED_MODELS.items():
        ts_fields = set(ts_interfaces.get(ts_name, []))
        python_fields = set(model.model_fields.keys())

        # Translate Python field names to their TS-side name where they differ.
        translated_python_fields = {renames.get(f, f) for f in python_fields}
        translated_python_fields -= ALLOWED_EXTRA_TS_FIELDS.get(ts_name, set())
        ts_fields_for_comparison = ts_fields - ALLOWED_EXTRA_TS_FIELDS.get(ts_name, set())

        missing_in_ts = translated_python_fields - ts_fields_for_comparison
        missing_in_python = ts_fields_for_comparison - translated_python_fields

        if missing_in_ts:
            mismatches.append(
                f"{ts_name}: Pydantic has {sorted(missing_in_ts)} not in lib/types.ts"
            )
        if missing_in_python:
            mismatches.append(
                f"{ts_name}: lib/types.ts has {sorted(missing_in_python)} not in Pydantic"
            )

    assert not mismatches, "\n".join(mismatches)
