"""Run-history, flow-catalog, and doctor proxies onto a project's orq-lite serve.

Task 9/10 of the product-readiness plan, built against the query-API
contract in docs/orq-lite-query-api.md. Namespaced under /history (for the
run-history endpoints) so orquesta's own launch records (POST
/projects/{id}/runs, GET /runs) stay distinct from orq-lite's indexed run
history. When the project's serve predates the query API, the upstream 404
maps to RuntimeError -> 502 via OrqLiteClient; the frontend treats that as
"history unavailable — upgrade orq-lite".
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from orquesta_api.meta.query_models import (
    AgentRunsPage,
    AttemptDiff,
    CostStats,
    DoctorReport,
    FlowCatalog,
    OrqRunEventsPage,
    OrqRunsPage,
    OrqRunSummary,
)
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.serves import ServeManager

router = APIRouter(prefix="/projects", tags=["history"])


def _get_aggregator(request: Request) -> Aggregator:
    serves: ServeManager = request.app.state.serves
    return Aggregator(serves=serves)


AggregatorDep = Annotated[Aggregator, Depends(_get_aggregator)]


@router.get("/{project_id}/history/runs")
async def list_history_runs(
    project_id: str,
    agg: AggregatorDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    active: Annotated[bool | None, Query()] = None,
) -> OrqRunsPage:
    """List the project's orq-lite run history, newest-first."""
    return await agg.list_runs(project_id, limit=limit, offset=offset, active=active)


@router.get("/{project_id}/history/runs/{run_id}")
async def get_history_run(project_id: str, run_id: str, agg: AggregatorDep) -> OrqRunSummary:
    """Return one indexed run's summary."""
    return await agg.get_run(project_id, run_id)


@router.get("/{project_id}/history/runs/{run_id}/events")
async def get_history_run_events(
    project_id: str,
    run_id: str,
    agg: AggregatorDep,
    type: Annotated[str | None, Query()] = None,  # mirrors the upstream param name
    task_id: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> OrqRunEventsPage:
    """Return one run's event timeline in log order."""
    return await agg.get_run_events(
        project_id, run_id, event_type=type, task_id=task_id, limit=limit, offset=offset
    )


@router.get("/{project_id}/history/agent-runs")
async def get_history_agent_runs(
    project_id: str,
    agg: AggregatorDep,
    run_id: Annotated[str | None, Query()] = None,
    task_id: Annotated[str | None, Query()] = None,
    role: Annotated[str | None, Query()] = None,
    agent: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AgentRunsPage:
    """Return agent invocations with duration/token/cost detail, newest-first."""
    return await agg.get_agent_runs(
        project_id,
        run_id=run_id,
        task_id=task_id,
        role=role,
        agent=agent,
        limit=limit,
        offset=offset,
    )


@router.get("/{project_id}/history/cost")
async def get_history_cost(
    project_id: str,
    agg: AggregatorDep,
    by: Annotated[str, Query(pattern="^(run|agent|task|role)$")] = "run",
) -> CostStats:
    """Return cost aggregated by run, agent, task, or role."""
    return await agg.get_cost_stats(project_id, by=by)


@router.get("/{project_id}/flow-catalog")
async def get_flow_catalog(project_id: str, agg: AggregatorDep) -> FlowCatalog:
    """Return the serve's parsed flow catalog (inputs schema + per-role preflight)."""
    return await agg.get_flow_catalog(project_id)


@router.get("/{project_id}/doctor")
async def get_doctor(project_id: str, agg: AggregatorDep) -> DoctorReport:
    """Return the serve's preflight report."""
    return await agg.get_doctor(project_id)


@router.get("/{project_id}/attempt-diff/{task_id}/{role}/{cycle}/{attempt}")
async def get_attempt_diff(
    project_id: str, task_id: str, role: str, cycle: int, attempt: int, agg: AggregatorDep
) -> AttemptDiff:
    """Return the per-attempt diff artifact for one agent invocation."""
    return await agg.get_attempt_diff(project_id, task_id, role, cycle, attempt)
