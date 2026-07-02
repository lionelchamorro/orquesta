"""Golden regression test: TeamConfigStore must preserve rate_limit_backoff.

Bug being fixed: the old _dump_team() only serialised fields present in the
TeamDefinition Pydantic model, silently dropping any extra fields in team.json
(notably rate_limit_backoff, which orq-lite's Config.Validate() *requires* and
whose absence makes the project un-startable).

TDD order:
  1. Run with the old typed-round-trip implementation → RED (TypeError because
     the old constructor signature was `path: str | None`, not `workspace: Path`)
  2. Implement the raw read-merge-write fix → GREEN
"""

import json
from pathlib import Path

import pytest

from orquesta_api.services.config_files import FlowConfigStore, TeamConfigStore

# ---------------------------------------------------------------------------
# Golden fixture: verbatim from orquesta-lite/internal/commands/assets/team.json
# ---------------------------------------------------------------------------

GOLDEN_TEAM: dict = {
    "agents": {
        "claude_sonnet": {
            "provider": "claude",
            "model": "claude-sonnet-4-6",
            "dangerously_skip_permissions": True,
            "rate_limit_pattern": "(?i)(rate_?limit|429|quota|session limit|usage limit)",
        },
        "claude_opus": {
            "provider": "claude",
            "model": "claude-opus-4-8",
            "dangerously_skip_permissions": True,
            "rate_limit_pattern": "(?i)(rate_?limit|429|quota|session limit|usage limit)",
        },
        "codex_gpt5": {
            "provider": "codex",
            "model": "gpt-5.5",
            "effort": "medium",
            "rate_limit_pattern": (
                "(?i)(429|usage limit reached|rate_?limit_exceeded|quota.*exceeded|usage limit)"
            ),
        },
    },
    "roles": {
        "planner": {
            "agents": ["claude_sonnet", "claude_opus"],
            "prompt": "prompts/factory-planner.md",
            "result_path": ".orquestalite/results/planner.json",
            "timeout_seconds": 900,
        },
        "intake": {
            "agents": ["claude_opus", "claude_sonnet"],
            "prompt": "prompts/intake.md",
            "result_path": ".orquestalite/results/intake.json",
            "timeout_seconds": 600,
        },
        "parser": {
            "agents": ["claude_opus"],
            "prompt": "prompts/parser.md",
            "result_path": ".orquestalite/results/parser.json",
            "timeout_seconds": 600,
            "decompose_prompt": "prompts/parser-decompose.md",
        },
        "compactor": {
            "agents": ["claude_sonnet", "claude_opus"],
            "prompt": "prompts/memory-compactor.md",
            "result_path": ".orquestalite/results/compactor.json",
            "timeout_seconds": 600,
        },
        "coder": {
            "agents": ["codex_gpt5", "claude_sonnet"],
            "prompt": "prompts/coder.md",
            "result_path": ".orquestalite/results/coder.json",
            "timeout_seconds": 1800,
        },
        "tester": {
            "agents": ["claude_sonnet", "codex_gpt5"],
            "prompt": "prompts/tester.md",
            "result_path": ".orquestalite/results/tester.json",
            "timeout_seconds": 900,
        },
        "critic": {
            "agents": ["claude_opus", "codex_gpt5"],
            "prompt": "prompts/critic.md",
            "result_path": ".orquestalite/results/critic.json",
            "timeout_seconds": 600,
        },
        "verifier": {
            "agents": ["claude_sonnet", "codex_gpt5"],
            "prompt": "prompts/verifier.md",
            "result_path": ".orquestalite/results/verifier.json",
            "timeout_seconds": 600,
            "mode": "per_cycle",
            "cycle_prompt": "prompts/verifier-cycle.md",
        },
        "reviewer": {
            "agents": ["claude_opus", "codex_gpt5"],
            "prompt": "prompts/reviewer.md",
            "result_path": ".orquestalite/results/reviewer.json",
            "timeout_seconds": 900,
        },
        "generalist": {
            "agents": ["claude_sonnet", "claude_opus"],
            "prompt": "prompts/generalist.md",
            "result_path": ".orquestalite/results/generalist.json",
            "timeout_seconds": 1800,
        },
    },
    "limits": {"max_review_cycles": 3, "max_fix_iterations": 5, "verify_tester_command": True},
    "rate_limit_backoff": {
        "initial_seconds": 30,
        "factor": 2,
        "max_seconds": 1800,
        "default_pattern": (
            "(?i)(rate_?limit|429|quota|too many requests|session limit|usage limit)"
        ),
    },
    "full_test_command": "go test ./...",
    "lint_command": "",
}


# ---------------------------------------------------------------------------
# Python mirror of orq-lite's Config.Validate() rules
# ---------------------------------------------------------------------------


def _validate_orqlite_config(config: dict) -> None:
    """Assert that config passes orq-lite's Go Config.Validate() rules.

    This is a Python mirror of the subset of rules that can be checked without
    the Go provider registry. Raises AssertionError with a descriptive message
    if any rule is violated.
    """
    agents: dict = config.get("agents", {})
    assert agents, "no agents declared"

    roles: dict = config.get("roles", {})
    for role_name, role in roles.items():
        role_agents: list = role.get("agents", [])
        assert role_agents, f"role {role_name!r}: no agents"
        for agent_name in role_agents:
            assert agent_name in agents, f"role {role_name!r}: unknown agent {agent_name!r}"
        for agent_name in role.get("escalation_ladder", []):
            assert agent_name in agents, (
                f"role {role_name!r}: unknown escalation agent {agent_name!r}"
            )
        assert role.get("prompt"), f"role {role_name!r}: missing prompt"
        assert role.get("result_path"), f"role {role_name!r}: missing result_path"
        assert (role.get("timeout_seconds") or 0) > 0, f"role {role_name!r}: timeout_seconds <= 0"
        mode = role.get("mode", "")
        assert mode in ("", "per_task", "per_cycle", "both"), (
            f"role {role_name!r}: invalid mode {mode!r}"
        )

    for agent_name, agent in agents.items():
        has_cmd = bool(agent.get("cmd"))
        has_provider = bool(agent.get("provider"))
        assert has_cmd ^ has_provider, (
            f"agent {agent_name!r}: must have exactly one of cmd/provider (not both/neither)"
        )

    limits: dict = config.get("limits", {})
    assert (limits.get("max_review_cycles") or 0) > 0, "limits.max_review_cycles <= 0"
    assert (limits.get("max_fix_iterations") or 0) > 0, "limits.max_fix_iterations <= 0"

    rlb: dict = config.get("rate_limit_backoff", {})
    assert (rlb.get("initial_seconds") or 0) > 0, "rate_limit_backoff.initial_seconds <= 0"
    assert (rlb.get("factor") or 0) >= 2, "rate_limit_backoff.factor < 2"
    assert (rlb.get("max_seconds") or 0) >= (rlb.get("initial_seconds") or 0), (
        "rate_limit_backoff.max_seconds < initial_seconds"
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_team_update_preserves_rate_limit_backoff(tmp_path: Path) -> None:
    """Patching full_test_command must not drop rate_limit_backoff from team.json.

    This is the primary regression test for the bug: TeamConfigStore used to
    reconstruct team.json from only the fields known to TeamDefinition, silently
    dropping any extra fields (like rate_limit_backoff).
    """
    # Seed workspace with the golden fixture
    team_file = tmp_path / "team.json"
    team_file.write_text(json.dumps(GOLDEN_TEAM, indent=2))

    # Patch a single field via the new raw-merge API
    store = TeamConfigStore(tmp_path)
    store.update(patch={"full_test_command": "pytest"})

    # Re-read the raw file from disk (bypassing any in-memory state)
    reread: dict = json.loads(team_file.read_text())

    # The patched field must have changed
    assert reread["full_test_command"] == "pytest", (
        f"full_test_command was not updated: {reread.get('full_test_command')!r}"
    )

    # rate_limit_backoff must still be present and intact
    assert "rate_limit_backoff" in reread, (
        "rate_limit_backoff was DROPPED — this is the blocking bug"
    )
    assert reread["rate_limit_backoff"] == GOLDEN_TEAM["rate_limit_backoff"], (
        f"rate_limit_backoff changed: {reread['rate_limit_backoff']!r}"
    )

    # Full orq-lite Config.Validate() mirror must pass
    _validate_orqlite_config(reread)


def test_team_update_preserves_nested_unknown_limits_fields(tmp_path: Path) -> None:
    """Deep-merge must preserve unknown nested keys inside the 'limits' dict."""
    fixture = dict(GOLDEN_TEAM)
    fixture["limits"] = {
        "max_review_cycles": 3,
        "max_fix_iterations": 5,
        "verify_tester_command": True,
        "preflight_enabled": True,  # unknown future field
        "fast_mode": False,  # unknown future field
    }
    (tmp_path / "team.json").write_text(json.dumps(fixture))

    store = TeamConfigStore(tmp_path)
    store.update(patch={"limits": {"max_review_cycles": 5}})

    reread: dict = json.loads((tmp_path / "team.json").read_text())
    limits = reread["limits"]
    assert limits["max_review_cycles"] == 5, "patched field not updated"
    assert limits["max_fix_iterations"] == 5, "max_fix_iterations was dropped"
    assert limits.get("preflight_enabled") is True, "unknown preflight_enabled was dropped"
    assert limits.get("fast_mode") is False, "unknown fast_mode was dropped"


def test_flow_upsert_preserves_other_flows(tmp_path: Path) -> None:
    """Upserting one flow must not disturb other flows in flows.json."""
    flows_file = tmp_path / "flows.json"
    initial = {
        "flows": {
            "alpha": {"name": "Alpha", "description": "First flow", "steps": []},
            "beta": {"name": "Beta", "description": "Second flow", "steps": []},
        }
    }
    flows_file.write_text(json.dumps(initial))

    store = FlowConfigStore(tmp_path)
    store.upsert("alpha", {"name": "Alpha Updated", "description": "First flow"})

    reread: dict = json.loads(flows_file.read_text())
    assert reread["flows"]["alpha"]["name"] == "Alpha Updated"
    assert reread["flows"]["beta"]["name"] == "Beta", "beta was disturbed"


def test_flow_upsert_preserves_extra_fields_in_flow(tmp_path: Path) -> None:
    """Upserting a flow with a partial patch preserves extra fields in that flow entry."""
    flows_file = tmp_path / "flows.json"
    initial = {
        "flows": {
            "my-flow": {
                "name": "My Flow",
                "description": "A flow",
                "steps": [],
                "custom_scheduler": "cron",  # unknown extra field
            }
        }
    }
    flows_file.write_text(json.dumps(initial))

    store = FlowConfigStore(tmp_path)
    store.upsert("my-flow", {"name": "My Flow v2"})

    reread: dict = json.loads(flows_file.read_text())
    flow = reread["flows"]["my-flow"]
    assert flow["name"] == "My Flow v2", "name not updated"
    assert flow.get("custom_scheduler") == "cron", "extra field custom_scheduler was dropped"


@pytest.mark.parametrize(
    "patch,expected_error",
    [
        ({"rate_limit_backoff": {"initial_seconds": 0}}, "rate_limit_backoff.initial_seconds <= 0"),
        (
            {"rate_limit_backoff": {"initial_seconds": 30, "factor": 1}},
            "rate_limit_backoff.factor < 2",
        ),
    ],
)
def test_validate_detects_invalid_rate_limit_backoff(patch: dict, expected_error: str) -> None:
    """_validate_orqlite_config raises on invalid rate_limit_backoff values."""
    import copy

    config = copy.deepcopy(GOLDEN_TEAM)
    # Deep-merge the patch to simulate what the store would produce
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(config.get(k), dict):
            config[k] = {**config[k], **v}
        else:
            config[k] = v
    with pytest.raises(AssertionError, match=expected_error.replace(".", r"\.")):
        _validate_orqlite_config(config)
