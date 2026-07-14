"""Run-history, flow-catalog, doctor proxies, and local artifact browser.

Task 9/10 of the product-readiness plan, built against the query-API
contract in docs/orq-lite-query-api.md. Namespaced under /history (for the
run-history endpoints) so orquesta's own launch records (POST
/projects/{id}/runs, GET /runs) stay distinct from orq-lite's indexed run
history. When the project's serve predates the query API, the upstream 404
maps to RuntimeError -> 502 via OrqLiteClient; the frontend treats that as
"history unavailable — upgrade orq-lite".

The artifacts endpoints (list / read) operate on the local filesystem —
they do NOT proxy through the orq-lite serve — and need the project's
workspace_path from the control-plane database.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.db.tables import ProjectRow
from orquesta_api.meta.query_models import (
    AgentRunsPage,
    ArtifactContent,
    ArtifactListing,
    AttemptDiff,
    CostStats,
    DoctorReport,
    FlowCatalog,
    OrqRunEventsPage,
    OrqRunsPage,
    OrqRunSummary,
)
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.artifacts import ArtifactsService, PathTraversalError
from orquesta_api.services.serves import ServeManager

router = APIRouter(prefix="/projects", tags=["history"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


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


# ---------------------------------------------------------------------------
# Local artifact browser — reads from the project workspace filesystem.
# All paths are validated inside the run's artifact root.
# ---------------------------------------------------------------------------


async def _require_workspace(project_id: str, session: AsyncSession) -> str:
    """Return the project's workspace_path or raise 404 / 400."""
    row = await session.get(ProjectRow, project_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    if not row.workspace_path:
        raise HTTPException(
            status_code=400,
            detail=f"Project '{project_id}' has no workspace configured",
        )
    return row.workspace_path


@router.get("/{project_id}/history/runs/{run_id}/artifacts")
async def list_run_artifacts(
    project_id: str,
    run_id: str,
    session: SessionDep,
    path: Annotated[str, Query()] = "",
) -> ArtifactListing:
    """List files under a run's artifact directory.

    The ``path`` query parameter is a subpath relative to the run root
    (e.g. ``agents/F001/coder.c1.a1``).  Omit it to list the run root.
    Paths that escape the run root are rejected with HTTP 400.
    """
    workspace = await _require_workspace(project_id, session)
    svc = ArtifactsService(workspace_path=workspace)
    try:
        listing = await svc.list_dir(run_id=run_id, subpath=path)
    except PathTraversalError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ArtifactListing(
        root=listing.root,
        dir=listing.dir,
        entries=[
            {  # type: ignore[arg-type]
                "name": e.name,
                "size": e.size,
                "is_dir": e.is_dir,
                "path": e.path,
            }
            for e in listing.entries
        ],
    )


@router.get("/{project_id}/history/runs/{run_id}/artifacts/file")
async def read_run_artifact_file(
    project_id: str,
    run_id: str,
    session: SessionDep,
    path: Annotated[str, Query(min_length=1)],
) -> ArtifactContent:
    """Return the text content of one file from a run's artifact directory.

    ``path`` is relative to the run root (e.g.
    ``agents/F001/coder.c1.a1/stderr.log``).  Files larger than 256 KiB are
    truncated.  Paths escaping the run root are rejected with HTTP 400.
    """
    workspace = await _require_workspace(project_id, session)
    svc = ArtifactsService(workspace_path=workspace)
    try:
        result = await svc.read_file(run_id=run_id, subpath=path)
    except PathTraversalError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IsADirectoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ArtifactContent(
        path=result.path,
        content=result.content,
        size=result.size,
        truncated=result.truncated,
    )
