"""Regression tests: Pydantic mirror models tolerate orq-lite omitempty JSON."""

from orquesta_api.meta.models import (
    AgentRole,
    Feature,
    FeatureStatus,
    Task,
    TaskStatus,
    VerifyState,
)

# ---------------------------------------------------------------------------
# Task: omitempty fields missing from orq-lite JSON
# ---------------------------------------------------------------------------


def test_task_minimal_no_verify_state_no_last_agent() -> None:
    """Task validates when verify_state and last_agent are absent (omitempty in Go)."""
    t = {
        "id": "task-1",
        "status": "pending",
        "attempts": 0,
        "title": "Do something",
    }
    task = Task(**t)
    assert task.verify_state == VerifyState.empty
    assert task.last_agent == ""


def test_task_with_last_agent_as_plain_string() -> None:
    """last_agent accepts an arbitrary agent name string, not an enum value."""
    t = {
        "id": "task-2",
        "status": "in_progress",
        "attempts": 1,
        "title": "In flight",
        "last_agent": "claude-coder-main",  # arbitrary agent name, not a role enum
    }
    task = Task(**t)
    assert task.last_agent == "claude-coder-main"


def test_task_with_role_name_as_last_agent() -> None:
    """last_agent accepts a role name string too (it's just a string field)."""
    t = {
        "id": "task-3",
        "status": "done",
        "attempts": 2,
        "title": "Done task",
        "last_agent": "coder",
    }
    task = Task(**t)
    assert task.last_agent == "coder"


# ---------------------------------------------------------------------------
# Feature: omitempty fields missing from orq-lite JSON (freshly-queued pending)
# ---------------------------------------------------------------------------


def test_feature_minimal_pending() -> None:
    """Feature validates with only id/status/title — all omitempty fields get defaults."""
    f = {
        "id": "feat-1",
        "status": "pending",
        "title": "New feature",
    }
    feature = Feature(**f)
    assert feature.cost_usd == 0.0
    assert feature.tasks_done == 0
    assert feature.tasks_failed == 0
    assert feature.branch == ""
    assert feature.pr_url is None


def test_feature_partial_fields() -> None:
    """Feature validates when only some omitempty fields are present."""
    f = {
        "id": "feat-2",
        "status": "in_progress",
        "title": "Partial feature",
        "branch": "feat/foo",
        "tasks_done": 3,
    }
    feature = Feature(**f)
    assert feature.branch == "feat/foo"
    assert feature.tasks_done == 3
    assert feature.tasks_failed == 0
    assert feature.cost_usd == 0.0


# ---------------------------------------------------------------------------
# AgentRole: 9 real values + intake
# ---------------------------------------------------------------------------


def test_agent_role_covers_real_values() -> None:
    """AgentRole covers the full set emitted by orq-lite."""
    expected = {
        "planner",
        "parser",
        "coder",
        "tester",
        "critic",
        "reviewer",
        "verifier",
        "compactor",
        "generalist",
        "intake",
    }
    actual = {r.value for r in AgentRole}
    assert expected == actual, f"Missing roles: {expected - actual}"


# ---------------------------------------------------------------------------
# TaskStatus / FeatureStatus regression: existing coverage is sufficient
# ---------------------------------------------------------------------------


def test_task_status_covers_decomposed_and_needs_clarification() -> None:
    """TaskStatus already covers all orq-lite values including rarer ones."""
    assert TaskStatus("decomposed") == TaskStatus.decomposed
    assert TaskStatus("needs_clarification") == TaskStatus.needs_clarification


def test_feature_status_covers_factory_subset() -> None:
    """FeatureStatus covers the values emitted by factory.go."""
    factory_values = {"pending", "in_progress", "done", "failed"}
    actual = {s.value for s in FeatureStatus}
    assert factory_values.issubset(actual), f"Missing: {factory_values - actual}"
