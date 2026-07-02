"""Projects router: CRUD endpoints for the project registry."""

import re
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.db.tables import ProjectRow
from orquesta_api.meta.models import Feature, Project, ProjectState, ProjectWatch, Task
from orquesta_api.services.aggregator import Aggregator, CostSnapshot
from orquesta_api.services.projects import ProjectService
from orquesta_api.services.serves import ServeManager

# Role names are opaque strings owned by team.json, not a closed enum (orq-lite
# accepts arbitrary role names and returns null for unknown ones itself,
# web/server.go:95-104). This only guards against path-traversal-shaped input.
_VALID_ROLE_PATTERN = re.compile(r"^[a-z0-9_-]{1,32}$")

router = APIRouter(prefix="/projects", tags=["projects"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _get_serves(request: Request) -> ServeManager:
    """FastAPI dependency: read ServeManager from app.state.serves."""
    return request.app.state.serves  # type: ignore[no-any-return]


ServesDep = Annotated[ServeManager, Depends(_get_serves)]


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
async def create_project(body: ProjectCreate, session: SessionDep, serves: ServesDep) -> Project:
    """Register a new project."""
    svc = ProjectService(session, serves=serves)
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
    prune: Annotated[bool, Query()] = False,
) -> None:
    """Remove a project from the registry."""
    svc = ProjectService(session, serves=serves)
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
async def get_project_result(
    project_id: str, role: str, session: SessionDep, serves: ServesDep
) -> dict:
    """Return result JSON for role from the active orq-lite serve; 400 for invalid roles."""
    if not _VALID_ROLE_PATTERN.match(role):
        raise ValueError(f"invalid role {role!r}")
    agg = Aggregator(serves=serves)
    return await agg.get_result(project_id, role)
