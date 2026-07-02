"""Unit tests for build_argv — per-kind orq-lite CLI argument construction."""

import pytest

from orquesta_api.executors.local import build_argv
from orquesta_api.meta.models import RunKind, RunSpec


def spec(**kw) -> RunSpec:
    base = {"project_id": "p", "workspace_path": "/ws", "kind": RunKind.run}
    return RunSpec(**{**base, **kw})


@pytest.mark.parametrize(
    ("s", "expected"),
    [
        (spec(kind=RunKind.run), ["orq-lite", "run"]),
        (spec(kind=RunKind.factory), ["orq-lite", "factory", "--serve=false"]),
        (
            spec(kind=RunKind.factory, plan_path="features.md"),
            ["orq-lite", "factory", "--serve=false", "features.md"],
        ),
        (spec(kind=RunKind.plan, plan_path="plan.md"), ["orq-lite", "plan", "plan.md"]),
        (
            spec(
                kind=RunKind.flow,
                flow="pr_review",
                inputs={"pr_number": "42", "publish": "true"},
            ),
            ["orq-lite", "flow", "run", "pr_review", "pr_number=42", "publish=true"],
        ),
    ],
)
def test_build_argv(s: RunSpec, expected: list[str]) -> None:
    assert build_argv("orq-lite", s) == expected


def test_flow_requires_name() -> None:
    with pytest.raises(ValueError, match="flow"):
        build_argv("orq-lite", spec(kind=RunKind.flow))


def test_plan_requires_path() -> None:
    with pytest.raises(ValueError, match="plan_path"):
        build_argv("orq-lite", spec(kind=RunKind.plan))
