"""Tests for overview spend consistency.

Entry A fix: overview spend (from GET /projects) must equal the sum of
individual project spends returned by GET /projects/{id}, both of which
now come from the orq-lite serve via the Aggregator.
"""

from __future__ import annotations

import httpx
import pytest

import orquesta_api.routers.projects as projects_module
from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.db.tables import ProjectRow
from orquesta_api.routers.projects import list_projects
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.serves import ServeManager


class _FakeAliveProcess:
    """Minimal stand-in for asyncio.subprocess.Process with returncode=None."""

    returncode: int | None = None


def _make_mock_aggregator_class(costs: dict[str, float]) -> type:
    """Return an Aggregator subclass whose snapshot() uses a mock HTTP client.

    ``costs`` maps project_id → total_usd to return from the mock serve.
    """
    port_by_project: dict[str, int] = {pid: 10000 + i for i, pid in enumerate(costs)}

    def handler(request: httpx.Request) -> httpx.Response:
        port = request.url.port
        project_id = next((pid for pid, p in port_by_project.items() if p == port), None)
        if project_id is None:
            return httpx.Response(404)
        if request.url.path == "/api/cost":
            return httpx.Response(200, json={"available": True, "total_usd": costs[project_id]})
        if request.url.path in ("/api/tasks", "/api/factory"):
            return httpx.Response(200, json={"tasks": [], "features": []})
        return httpx.Response(404)

    mock_client = OrqLiteClient(transport=httpx.MockTransport(handler))

    def _make_serves() -> ServeManager:
        serves = ServeManager()
        for pid, port in port_by_project.items():
            serves._ports[pid] = port
            serves._processes[pid] = _FakeAliveProcess()  # type: ignore[assignment]
        return serves

    class _MockAggregator(Aggregator):
        def __init__(self, serves: ServeManager, **kwargs: object) -> None:  # type: ignore[override]
            super().__init__(serves, client=mock_client)

    return _MockAggregator, _make_serves


async def test_list_projects_returns_live_cost_from_aggregator(
    session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """GET /projects cost_usd matches the serve's reported total_usd."""
    session.add_all(
        [
            ProjectRow(
                id="proj-a",
                name="Project A",
                workspace_path="/ws/a",
                cost_usd=0.0,  # DB column always 0 — real cost comes from serve
            ),
            ProjectRow(
                id="proj-b",
                name="Project B",
                workspace_path="/ws/b",
                cost_usd=0.0,
            ),
        ]
    )
    await session.commit()

    costs = {"proj-a": 5.25, "proj-b": 3.17}
    MockAggregator, make_serves = _make_mock_aggregator_class(costs)
    monkeypatch.setattr(projects_module, "Aggregator", MockAggregator)

    serves = make_serves()
    result = await list_projects(session=session, serves=serves)

    cost_by_id = {p.id: p.cost_usd for p in result}
    assert cost_by_id["proj-a"] == 5.25, f"proj-a cost: {cost_by_id['proj-a']}"
    assert cost_by_id["proj-b"] == 3.17, f"proj-b cost: {cost_by_id['proj-b']}"
    assert abs(sum(cost_by_id.values()) - (5.25 + 3.17)) < 1e-9


async def test_list_projects_cost_zero_when_serve_unavailable(session) -> None:
    """When a project has no active serve, cost_usd is 0.0 (graceful degradation)."""
    session.add(
        ProjectRow(
            id="no-serve",
            name="No Serve",
            workspace_path="/ws/no-serve",
            cost_usd=0.0,
        )
    )
    await session.commit()

    # No ports registered → Aggregator.snapshot() returns Snapshot() with cost=0.
    serves = ServeManager()

    result = await list_projects(session=session, serves=serves)

    assert len(result) == 1
    assert result[0].cost_usd == 0.0


async def test_overview_spend_equals_sum_of_project_spends(
    session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Dashboard totalCost (sum of cost_usd) equals sum of individual project spends.

    This is the root-cause test: the dashboard reduces p.cost_usd across the
    list-projects response.  The individual project endpoint returns the same
    cost from the Aggregator, so both must agree for the same fixture.
    """
    from orquesta_api.routers.projects import get_project

    session.add_all(
        [
            ProjectRow(id="x1", name="X1", workspace_path="/ws/x1", cost_usd=0.0),
            ProjectRow(id="x2", name="X2", workspace_path="/ws/x2", cost_usd=0.0),
        ]
    )
    await session.commit()

    costs = {"x1": 10.48, "x2": 2.00}
    MockAggregator, make_serves = _make_mock_aggregator_class(costs)
    monkeypatch.setattr(projects_module, "Aggregator", MockAggregator)

    serves = make_serves()
    all_projects = await list_projects(session=session, serves=serves)
    p1 = await get_project("x1", session=session, serves=serves)
    p2 = await get_project("x2", session=session, serves=serves)

    overview_total = sum(p.cost_usd for p in all_projects)
    individual_total = p1.cost_usd + p2.cost_usd

    assert abs(overview_total - individual_total) < 1e-9, (
        f"overview total {overview_total} != sum of individuals {individual_total}"
    )
