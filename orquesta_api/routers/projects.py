"""Projects router: CRUD endpoints for the project registry."""

import asyncio
import re
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import (
    Feature,
    Project,
    ProjectState,
    ProjectWatch,
    ReviewRun,
    Run,
    RunKind,
    RunState,
    Task,
)
from orquesta_api.services.aggregator import Aggregator, CostSnapshot
from orquesta_api.services.events import EventIngestManager
from orquesta_api.services.projects import ProjectService
from orquesta_api.services.runs import RunSupervisor, _make_executor
from orquesta_api.services.serves import ServeManager

# Role names are opaque strings owned by team.json, not a closed enum (orq-lite
# accepts arbitrary role names and returns null for unknown ones itself,
# web/server.go:95-104). This only guards against path-traversal-shaped input.
_VALID_ROLE_PATTERN = re.compile(r"^[a-z0-9_-]{1,32}$")

_GITHUB_HTTPS = re.compile(r"^https://github\.com/([^/]+/[^/]+?)(?:\.git)?/?$")
_GITHUB_SSH = re.compile(r"^git@github\.com:([^/]+/[^/]+?)(?:\.git)?$")


def _github_pr_url(repo_url: str | None, pr_number: int) -> str | None:
    if not repo_url:
        return None
    m = _GITHUB_HTTPS.match(repo_url) or _GITHUB_SSH.match(repo_url)
    if m is None:
        return None
    return f"https://github.com/{m.group(1)}/pull/{pr_number}"


def _get_executor() -> ExecutorInterface:
    return _make_executor()

router = APIRouter(prefix="/projects", tags=["projects"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _get_serves(request: Request) -> ServeManager:
    """FastAPI dependency: read ServeManager from app.state.serves."""
    return request.app.state.serves  # type: ignore[no-any-return]


def _get_ingest(request: Request) -> EventIngestManager:
    """FastAPI dependency: read EventIngestManager from app.state.ingest."""
    return request.app.state.ingest  # type: ignore[no-any-return]


ServesDep = Annotated[ServeManager, Depends(_get_serves)]
IngestDep = Annotated[EventIngestManager, Depends(_get_ingest)]
ExecutorDep = Annotated[ExecutorInterface, Depends(_get_executor)]


class TasksResponse(BaseModel):
    """Response body for GET /projects/{id}/tasks."""

    tasks: list[Task]


class FeaturesResponse(BaseModel):
    """Response body for GET /projects/{id}/factory."""

    features: list[Feature]


class ProjectCreate(BaseModel):
    """Request body for POST /projects."""

    name: str
    repo_url: str | None = None
    workspace_path: str | None = None
    base_branch: str
    description: str | None = None
    language: str | None = None
    watch: bool = False


class ProjectPatch(BaseModel):
    """Request body for PATCH /projects/{id}."""

    name: str | None = None
    base_branch: str | None = None
    watch: ProjectWatch | None = None
    description: str | None = None


def _row_to_project(row: ProjectRow) -> Project:
    return Project(
        id=row.id,
        name=row.name,
        repo_url=row.repo_url or "",
        workspace_path=row.workspace_path or "",
        base_branch=row.base_branch,
        watch=ProjectWatch(prs=row.watch_prs, issues=row.watch_issues),
        state=ProjectState(row.state),
        description=row.description or "",
        language=row.language or "",
        cost_usd=row.cost_usd,
        last_run=row.last_run.isoformat() if row.last_run else "",
    )


@router.get("")
async def list_projects(session: SessionDep) -> list[Project]:
    """Return all registered projects."""
    svc = ProjectService(session)
    rows = await svc.list()
    return [_row_to_project(r) for r in rows]


@router.post("", status_code=201)
async def create_project(
    body: ProjectCreate, session: SessionDep, serves: ServesDep, ingest: IngestDep
) -> Project:
    """Register a new project."""
    svc = ProjectService(session, serves=serves, ingest=ingest)
    row = await svc.create(
        name=body.name,
        repo_url=body.repo_url,
        workspace_path=body.workspace_path,
        base_branch=body.base_branch,
        description=body.description,
        language=body.language,
        watch=body.watch,
    )
    return _row_to_project(row)


@router.get("/{project_id}")
async def get_project(project_id: str, session: SessionDep, serves: ServesDep) -> Project:
    """Return a single project by id."""
    svc = ProjectService(session)
    row = await svc.get(project_id)
    agg = Aggregator(serves=serves)
    snapshot = await agg.snapshot(project_id)
    return _row_to_project(row).model_copy(
        update={
            "tasks": snapshot.tasks,
            "features": snapshot.features,
            "cost_usd": snapshot.cost.total_usd,
        }
    )


@router.patch("/{project_id}")
async def patch_project(project_id: str, body: ProjectPatch, session: SessionDep) -> Project:
    """Update allowed fields on a project."""
    svc = ProjectService(session)
    patch = body.model_dump(exclude_none=True)
    row = await svc.update(project_id, **patch)
    return _row_to_project(row)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    session: SessionDep,
    serves: ServesDep,
    ingest: IngestDep,
    prune: Annotated[bool, Query()] = False,
) -> None:
    """Remove a project from the registry."""
    svc = ProjectService(session, serves=serves, ingest=ingest)
    await svc.delete(project_id, prune=prune)


@router.get("/{project_id}/tasks")
async def get_project_tasks(
    project_id: str, session: SessionDep, serves: ServesDep
) -> TasksResponse:
    """Return tasks proxied from the active orq-lite serve, or empty list if none."""
    agg = Aggregator(serves=serves)
    snapshot = await agg.snapshot(project_id)
    return TasksResponse(tasks=snapshot.tasks)


@router.get("/{project_id}/factory")
async def get_project_factory(
    project_id: str, session: SessionDep, serves: ServesDep
) -> FeaturesResponse:
    """Return features proxied from the active orq-lite serve, or empty list if none."""
    agg = Aggregator(serves=serves)
    snapshot = await agg.snapshot(project_id)
    return FeaturesResponse(features=snapshot.features)


@router.get("/{project_id}/cost")
async def get_project_cost(project_id: str, session: SessionDep, serves: ServesDep) -> CostSnapshot:
    """Return cost proxied from the active orq-lite serve, or unavailable if none."""
    agg = Aggregator(serves=serves)
    snapshot = await agg.snapshot(project_id)
    return snapshot.cost


@router.get("/{project_id}/diff/{task_id}")
async def get_project_diff(
    project_id: str, task_id: str, session: SessionDep, serves: ServesDep
) -> PlainTextResponse:
    """Return diff text for task_id proxied from the active orq-lite serve."""
    agg = Aggregator(serves=serves)
    diff = await agg.get_diff(project_id, task_id)
    return PlainTextResponse(diff)


@router.get("/{project_id}/result/{role}")
# ast-grep-ignore: no-dict-return-annotation
async def get_project_result(
    project_id: str, role: str, session: SessionDep, serves: ServesDep
) -> dict:
    """Return result JSON for role from the active orq-lite serve; 400 for invalid roles."""
    if not _VALID_ROLE_PATTERN.match(role):
        raise ValueError(f"invalid role {role!r}")
    agg = Aggregator(serves=serves)
    return await agg.get_result(project_id, role)


async def _pr_review_rows(session: AsyncSession, project_id: str) -> Sequence[RunRow]:
    """Return all pr_review flow runs for *project_id*, newest-first."""
    result = await session.execute(
        select(RunRow)
        .where(
            RunRow.project_id == project_id,
            RunRow.kind == RunKind.flow.value,
            RunRow.flow == "pr_review",
        )
        .order_by(
            RunRow.started_at.desc().nullslast(),
            RunRow.created_at.desc().nullslast(),
            RunRow.id.desc(),
        )
    )
    return result.scalars().all()


async def _orq_cost_duration(
    agg: Aggregator, project_id: str, orq_run_id: str | None
) -> tuple[float | None, float | None]:
    """Return (duration_s, cost_usd) from the orq-lite serve history, or (None, None).

    Expected failure modes are ValueError (no serve running) and RuntimeError
    (serve reachable but history unavailable or returned an error status).
    Anything else propagates so genuine bugs surface.
    """
    if orq_run_id is None:
        return None, None
    try:
        summary = await agg.get_run(project_id, orq_run_id)
        return summary.duration_s, summary.cost_usd
    except (ValueError, RuntimeError):
        return None, None


@router.get("/{project_id}/reviews")
async def get_project_reviews(
    project_id: str, session: SessionDep, serves: ServesDep
) -> list[ReviewRun]:
    """Return pr_review flow runs for the project, newest-first."""
    project = await session.get(ProjectRow, project_id)
    if project is None:
        raise ValueError(f"Project '{project_id}' not found")

    rows = await _pr_review_rows(session, project_id)
    agg = Aggregator(serves=serves)
    async with asyncio.TaskGroup() as tg:
        cost_tasks = [
            tg.create_task(_orq_cost_duration(agg, project_id, row.orq_run_id)) for row in rows
        ]
    reviews: list[ReviewRun] = []
    for row, cost_task in zip(rows, cost_tasks, strict=True):
        pr_number_raw = (row.inputs or {}).get("pr_number")
        pr_number = int(pr_number_raw) if pr_number_raw and pr_number_raw.isdigit() else None
        pr_url = _github_pr_url(project.repo_url, pr_number) if pr_number is not None else None
        duration_s, cost_usd = cost_task.result()
        reviews.append(
            ReviewRun(
                run_id=row.id,
                pr_number=pr_number,
                pr_url=pr_url,
                state=RunState(row.state),
                started_at=row.started_at,
                finished_at=row.finished_at,
                duration_s=duration_s,
                cost_usd=cost_usd,
            )
        )
    return reviews


@router.post("/{project_id}/reviews/{pr_number}/rerun")
async def rerun_review(
    project_id: str, pr_number: int, session: SessionDep, executor: ExecutorDep
) -> Run:
    """Relaunch the most recent pr_review run for this pr_number using its persisted inputs."""
    rows = await _pr_review_rows(session, project_id)
    target = next(
        (r for r in rows if (r.inputs or {}).get("pr_number") == str(pr_number)),
        None,
    )
    if target is None:
        raise ValueError(f"pr_review run for PR #{pr_number} not found")
    svc = RunSupervisor(session, executor=executor)
    return await svc.retry(target.id)
