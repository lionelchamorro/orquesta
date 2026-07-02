"""Task 6: engine-schema flow editor.

Covers:
  - validate_flow_steps mirrors the engine.Validate rules (engine.go:37-79).
  - FlowConfigStore round-trips the real step shape (type/agent/command/args/
    action/inputs/outputs/iterator/as/body/condition/max_retries/expression/
    on_failure) without inventing or dropping fields.
"""

import json
from pathlib import Path

import pytest

from orquesta_api.meta.models import FlowStep, validate_flow_steps
from orquesta_api.services.config_files import FlowConfigStore

# ---------------------------------------------------------------------------
# validate_flow_steps
# ---------------------------------------------------------------------------


def test_command_step_requires_exactly_one_of_command_args() -> None:
    neither = FlowStep(id="s1", type="command")
    both = FlowStep(id="s2", type="command", command="orq-lite", args=["run"])
    only_command = FlowStep(id="s3", type="command", command="orq-lite run")
    only_args = FlowStep(id="s4", type="command", args=["orq-lite", "run"])

    assert validate_flow_steps([neither])
    assert validate_flow_steps([both])
    assert validate_flow_steps([only_command]) == []
    assert validate_flow_steps([only_args]) == []


def test_agent_step_requires_agent() -> None:
    assert validate_flow_steps([FlowStep(id="s1", type="agent")])
    assert validate_flow_steps([FlowStep(id="s1", type="agent", agent="coder")]) == []


def test_action_step_requires_action() -> None:
    assert validate_flow_steps([FlowStep(id="s1", type="action")])
    assert validate_flow_steps([FlowStep(id="s1", type="action", action="publish_pr")]) == []


def test_loop_step_requires_iterator_and_as() -> None:
    assert validate_flow_steps([FlowStep(id="s1", type="loop")])
    assert validate_flow_steps([FlowStep(id="s1", type="loop", iterator="{{features}}")])
    ok = FlowStep(id="s1", type="loop", iterator="{{features}}", **{"as": "feature"})
    assert validate_flow_steps([ok]) == []


def test_loop_body_is_validated_recursively() -> None:
    bad_child = FlowStep(id="child", type="command")
    loop = FlowStep(id="s1", type="loop", iterator="{{x}}", **{"as": "x"}, body=[bad_child])
    errors = validate_flow_steps([loop])
    assert errors
    assert "(s1).steps[0](child)" in errors[0]["step"]


def test_retry_until_requires_condition() -> None:
    assert validate_flow_steps([FlowStep(id="s1", type="retry_until")])
    ok = FlowStep(id="s1", type="retry_until", condition="tests_pass")
    assert validate_flow_steps([ok]) == []


def test_eval_requires_expression() -> None:
    assert validate_flow_steps([FlowStep(id="s1", type="eval")])
    ok = FlowStep(id="s1", type="eval", expression="tasks_done == tasks_total")
    assert validate_flow_steps([ok]) == []


def test_on_failure_must_be_empty_or_continue() -> None:
    step = FlowStep(id="s1", type="command", command="orq-lite run")
    assert validate_flow_steps([step]) == []
    # Pydantic itself rejects any other literal at construction time.
    with pytest.raises(Exception):  # noqa: B017 — pydantic ValidationError
        FlowStep(id="s2", type="command", command="orq-lite run", on_failure="retry")


# ---------------------------------------------------------------------------
# FlowConfigStore round-trip with the real engine schema
# ---------------------------------------------------------------------------

GOLDEN_FLOWS: dict = {
    "flows": {
        "pr_review": {
            "name": "PR review",
            "description": "Review an open pull request end to end.",
            "team_id": "default",
            "variables": {},
            "custom_scheduler": "cron",  # unknown field that must survive edits
            "steps": [
                {
                    "id": "fetch",
                    "type": "command",
                    "label": "Fetch PR",
                    "command": "orq-lite pr fetch {{pr_number}}",
                    "depends_on": [],
                },
                {
                    "id": "review",
                    "type": "agent",
                    "label": "Review",
                    "agent": "reviewer",
                    "inputs": {"pr_number": "{{pr_number}}"},
                    "depends_on": ["fetch"],
                },
                {
                    "id": "wait_for_green",
                    "type": "retry_until",
                    "condition": "ci_status == 'success'",
                    "max_retries": 5,
                    "depends_on": ["review"],
                },
                {
                    "id": "publish",
                    "type": "action",
                    "action": "publish_review",
                    "on_failure": "continue",
                    "depends_on": ["wait_for_green"],
                },
            ],
        },
    }
}


def test_flow_roundtrip_preserves_unknown_and_step_shape(tmp_path: Path) -> None:
    flows_file = tmp_path / "flows.json"
    flows_file.write_text(json.dumps(GOLDEN_FLOWS, indent=2))

    store = FlowConfigStore(tmp_path)
    flow = store.list()[0]
    assert flow.id == "pr_review"
    assert flow.steps[0].type.value == "command"
    assert flow.steps[1].type.value == "agent"
    assert flow.steps[1].agent == "reviewer"
    assert flow.steps[2].type.value == "retry_until"
    assert flow.steps[2].condition == "ci_status == 'success'"
    assert flow.steps[3].on_failure == "continue"


def test_flow_edit_description_only_touches_description(tmp_path: Path) -> None:
    """Acceptance criterion: editing description must not perturb any other key."""
    flows_file = tmp_path / "flows.json"
    flows_file.write_text(json.dumps(GOLDEN_FLOWS, indent=2))

    store = FlowConfigStore(tmp_path)
    store.upsert("pr_review", {"description": "Review and merge an open pull request."})

    reread: dict = json.loads(flows_file.read_text())
    flow = reread["flows"]["pr_review"]

    assert flow["description"] == "Review and merge an open pull request."
    assert flow["custom_scheduler"] == "cron", "unknown top-level field was dropped"
    assert flow["steps"] == GOLDEN_FLOWS["flows"]["pr_review"]["steps"], (
        "steps must be untouched when only description is patched"
    )
