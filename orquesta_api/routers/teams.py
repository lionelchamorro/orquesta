"""Per-project team configuration endpoints backed by team.json.

Routes are nested under ``/projects/{project_id}`` so that each project's
team.json is read from and written to its own workspace directory — matching
exactly how ``orq-lite`` resolves the file at runtime.

The PUT body is a :class:`TeamDefinition` (full typed model) for FastAPI
validation and OpenAPI schema. The update workflow lives in
``TeamService.update_with_skills`` so the route stays focused on resolving the
project workspace.
"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.models import TeamDefinition
from orquesta_api.services.config_files import TeamConfigStore
from orquesta_api.services.projects import ProjectService
from orquesta_api.services.skills import load_skill_catalog
from orquesta_api.services.teams import TeamService

router = APIRouter(prefix="/projects", tags=["teams"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _get_workspace(project_id: str, session: AsyncSession) -> Path:
    """Resolve the workspace path for a project; raises ValueError if absent."""
    row = await ProjectService(session).get(project_id)
    if not row.workspace_path:
        raise ValueError(f"Project '{project_id}' has no workspace_path configured")
    return Path(row.workspace_path)


@router.get("/{project_id}/team")
async def get_team(project_id: str, session: SessionDep) -> TeamDefinition:
    """Return the team.json config for a project."""
    workspace = await _get_workspace(project_id, session)
    return TeamConfigStore(workspace).get("default")


@router.put("/{project_id}/team")
async def update_team(project_id: str, body: TeamDefinition, session: SessionDep) -> TeamDefinition:
    """Merge the request body onto the project's team.json and return the result.

    Unknown fields already present in team.json (e.g. ``rate_limit_backoff``)
    are preserved; only the fields known to ``TeamDefinition`` are patched.
    """
    workspace = await _get_workspace(project_id, session)
    return TeamService().update_with_skills(workspace, body, load_skill_catalog())
