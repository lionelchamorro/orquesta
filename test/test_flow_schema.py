"""Task 6: engine-schema flow editor.

Covers:
  - validate_flow_steps mirrors the engine.Validate rules (engine.go:37-79).
  - FlowConfigStore round-trips the real step shape (type/agent/command/args/
    action/inputs/outputs/iterator/as/body/condition/max_retries/expression/
    on_failure) without inventing or dropping fields.
  - The golden acceptance criterion: the REAL bundled flows.json from
    orq-lite (test/fixtures/orq_lite_bundled_flows.json, copied verbatim
    from orquesta-lite/internal/commands/assets/flows.json) survives the
    full UI save path — normalise (GET) -> FlowDefinition -> _to_raw_patch
    (PUT) -> upsert — with ONLY the edited field changed. No synthetic ids,
    no UI-only keys, nothing dropped.
"""

import json
from pathlib import Path

import pytest

from orquesta_api.meta.models import FlowStep, validate_flow_steps
from orquesta_api.routers.flows import _to_raw_patch
from orquesta_api.services.config_files import FlowConfigStore

FIXTURES = Path(__file__).parent / "fixtures"

# ---------------------------------------------------------------------------
# validate_flow_steps
# ---------------------------------------------------------------------------


def test_command_step_requires_exactly_one_of_command_args() -> None:
    neither = FlowStep(type="command")
    both = FlowStep(type="command", command="orq-lite", args=["run"])
    only_command = FlowStep(type="command", command="orq-lite run")
    only_args = FlowStep(type="command", args=["orq-lite", "run"])

    assert validate_flow_steps([neither])
    assert validate_flow_steps([both])
    assert validate_flow_steps([only_command]) == []
    assert validate_flow_steps([only_args]) == []


def test_agent_step_requires_agent() -> None:
    assert validate_flow_steps([FlowStep(type="agent")])
    assert validate_flow_steps([FlowStep(type="agent", agent="coder")]) == []


def test_action_step_requires_action() -> None:
    assert validate_flow_steps([FlowStep(type="action")])
    assert validate_flow_steps([FlowStep(type="action", action="publish_pr")]) == []


def test_loop_step_requires_iterator_and_as() -> None:
    assert validate_flow_steps([FlowStep(type="loop")])
    assert validate_flow_steps([FlowStep(type="loop", iterator="{features}")])
    ok = FlowStep(type="loop", iterator="{features}", **{"as": "feature"})
    assert validate_flow_steps([ok]) == []


def test_loop_body_is_validated_recursively() -> None:
    bad_child = FlowStep(type="command")
    loop = FlowStep(type="loop", iterator="{x}", **{"as": "x"}, body=[bad_child])
    errors = validate_flow_steps([loop])
    assert errors
    assert "steps[0](loop).steps[0](command)" in errors[0]["step"]


def test_retry_until_requires_condition() -> None:
    assert validate_flow_steps([FlowStep(type="retry_until")])
    ok = FlowStep(type="retry_until", condition="tests_pass")
    assert validate_flow_steps([ok]) == []


def test_eval_requires_expression() -> None:
    assert validate_flow_steps([FlowStep(type="eval")])
    ok = FlowStep(type="eval", expression="tasks_done == tasks_total")
    assert validate_flow_steps([ok]) == []


def test_on_failure_must_be_empty_or_continue() -> None:
    step = FlowStep(type="command", command="orq-lite run")
    assert validate_flow_steps([step]) == []
    # Pydantic itself rejects any other literal at construction time.
    with pytest.raises(Exception):  # noqa: B017 — pydantic ValidationError
        FlowStep(type="command", command="orq-lite run", on_failure="retry")


# ---------------------------------------------------------------------------
# FlowConfigStore round-trip with the real engine schema
# ---------------------------------------------------------------------------

GOLDEN_FLOWS: dict = {
    "flows": {
        "pr_review": {
            "description": "Review an open pull request end to end.",
            "inputs": {"pr_number": {"type": "string"}},
            "custom_scheduler": "cron",  # unknown field that must survive edits
            "steps": [
                {
                    "type": "command",
                    "args": ["gh", "pr", "checkout", "{inputs.pr_number}"],
                },
                {
                    "type": "agent",
                    "agent": "reviewer",
                    "inputs": {"pr_number": "{inputs.pr_number}"},
                    "outputs": {"review_res": "."},
                },
                {
                    "type": "retry_until",
                    "condition": "{ci_status} == 'success'",
                    "max_retries": 5,
                },
                {
                    "type": "action",
                    "action": "publish_review",
                    "on_failure": "continue",
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
    assert flow.steps[1].outputs == {"review_res": "."}
    assert flow.steps[2].type.value == "retry_until"
    assert flow.steps[2].condition == "{ci_status} == 'success'"
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
    assert sorted(flow.keys()) == sorted(GOLDEN_FLOWS["flows"]["pr_review"].keys()), (
        "no keys may be added or removed by a description-only patch"
    )


# ---------------------------------------------------------------------------
# Golden acceptance test: the REAL bundled flows.json through the full UI path
# ---------------------------------------------------------------------------


def test_real_bundled_flows_survive_full_ui_save_path(tmp_path: Path) -> None:
    """Simulate exactly what the console does: GET -> edit description -> PUT.

    The fixture is orq-lite's own bundled flows.json (factory +
    factory_fast, with nested loop/retry_until bodies, action steps, and
    command steps carrying outputs). After the round trip, every flow entry
    must be byte-identical except the one edited description — no synthetic
    ids, no UI-only keys (name/team_id/entrypoint/variables/tags), no
    dropped outputs.
    """
    import shutil

    shutil.copy(FIXTURES / "orq_lite_bundled_flows.json", tmp_path / "flows.json")
    before = json.loads((tmp_path / "flows.json").read_text())

    store = FlowConfigStore(tmp_path)
    factory = next(f for f in store.list() if f.id == "factory")
    assert validate_flow_steps(factory.steps) == [], "real bundled flow must validate clean"

    edited = factory.model_copy(update={"description": "edited description"})
    store.upsert("factory", _to_raw_patch(edited))

    after = json.loads((tmp_path / "flows.json").read_text())

    # The edited field changed...
    assert after["flows"]["factory"]["description"] == "edited description"

    # ...and nothing else did, at any depth.
    expected = json.loads(json.dumps(before))
    expected["flows"]["factory"]["description"] = "edited description"
    assert after == expected, "UI save path must not add, drop, or reshape any other key"
