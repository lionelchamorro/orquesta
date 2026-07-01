"""Repo lifecycle endpoints nested under /projects/{project_id}."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.models import Repo
from orquesta_api.services.repos import RepoManager

router = APIRouter(prefix="/projects/{project_id}/repo", tags=["repos"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def get_repo_status(project_id: str, session: SessionDep) -> Repo:
    """Return current git state for the project workspace."""
    mgr = RepoManager(session)
    return await mgr.status(project_id)


@router.post("/sync")
async def sync_repo(
    project_id: str,
    session: SessionDep,
    force: Annotated[bool, Query()] = False,
) -> Repo:
    """Fetch from origin and checkout base_branch."""
    mgr = RepoManager(session)
    return await mgr.sync(project_id, force=force)
