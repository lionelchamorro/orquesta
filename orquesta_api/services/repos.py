"""Repo lifecycle service: clone, adopt, status, and sync."""

import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.core.integrations import git
from orquesta_api.db.tables import ProjectRow, RepoRow, RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.models import Repo, RunState

logger = get_logger(__name__)

_ACTIVE_RUN_STATES = {RunState.queued, RunState.starting, RunState.running, RunState.stopping}


class CloneTargetError(Exception):
    """Raised when a clone target directory is non-empty and not a git repo."""


class WorkspaceDirtyError(Exception):
    """Raised when sync is refused because the workspace has uncommitted changes."""


class RunInFlightError(Exception):
    """Raised when sync is refused because a run is already in flight for the project."""


def _row_to_model(row: RepoRow) -> Repo:
    return Repo(
        project_id=row.project_id,
        root=row.root,
        remote_url=row.remote_url,
        base_branch=row.base_branch,
        head_sha=row.head_sha,
        current_branch=row.current_branch,
        dirty=row.dirty,
        managed=row.managed,
    )


class RepoManager:
    """Git lifecycle operations for registered projects."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def ensure(self, project: ProjectRow) -> Repo:
        """Initialise the project workspace via clone or adopt, returning the updated Repo."""
        repo_row = await self._get_repo_row(project.id)
        workspace = Path(repo_row.root)

        workspace_is_git = workspace.exists() and await asyncio.to_thread(
            git.is_git_repo, workspace
        )

        if workspace.exists() and any(workspace.iterdir()) and not workspace_is_git:
            raise CloneTargetError(
                f"Clone target '{workspace}' exists, is non-empty, and is not a git repo"
            )

        if workspace_is_git:
            # Refresh git state without touching the managed flag set at registration time.
            return await self._refresh(repo_row, workspace)

        if project.repo_url:
            return await self._clone(project.repo_url, workspace, repo_row)

        raise ValueError(
            f"Project '{project.id}' has no repo_url and no existing git repo at '{workspace}'"
        )

    async def status(self, project_id: str) -> Repo:
        """Read current git state for the project's workspace and persist it."""
        repo_row = await self._get_repo_row(project_id)
        workspace = Path(repo_row.root)
        state = await asyncio.to_thread(git.status, workspace)
        _apply_git_state(repo_row, state)
        await self._session.commit()
        logger.info("Refreshed repo status => %s", project_id)
        return _row_to_model(repo_row)

    async def sync(self, project_id: str, force: bool = False) -> Repo:
        """Fetch from origin and checkout base_branch; refuses if dirty or a run is active."""
        repo_row = await self._get_repo_row(project_id)
        workspace = Path(repo_row.root)

        state = await asyncio.to_thread(git.status, workspace)
        if state.dirty and not force:
            raise WorkspaceDirtyError(
                f"Workspace for project '{project_id}' has uncommitted changes;"
                " pass force=True to override"
            )

        active = await self._session.execute(
            select(RunRow).where(
                RunRow.project_id == project_id,
                RunRow.state.in_(_ACTIVE_RUN_STATES),
            )
        )
        if active.scalar_one_or_none() is not None:
            raise RunInFlightError(f"A run is in flight for project '{project_id}'")

        await asyncio.to_thread(git.fetch, workspace)
        await asyncio.to_thread(git.checkout, workspace, repo_row.base_branch)
        await asyncio.to_thread(git.merge_ff_only, workspace, repo_row.base_branch)

        new_state = await asyncio.to_thread(git.status, workspace)
        _apply_git_state(repo_row, new_state)
        await self._session.commit()
        logger.info("Synced repo => %s branch=%s", project_id, repo_row.base_branch)
        return _row_to_model(repo_row)

    async def _clone(self, url: str, dest: Path, repo_row: RepoRow) -> Repo:
        await asyncio.to_thread(git.clone, url, str(dest))
        state = await asyncio.to_thread(git.status, dest)
        repo_row.managed = True
        repo_row.remote_url = url
        _apply_git_state(repo_row, state)
        await self._session.commit()
        logger.info("Cloned repo => %s managed=True", dest)
        return _row_to_model(repo_row)

    async def _refresh(self, repo_row: RepoRow, workspace: Path) -> Repo:
        """Refresh git state for an existing repo without altering the managed flag.

        managed is owned by registration (ProjectService.create), not recomputed here.
        """
        state = await asyncio.to_thread(git.status, workspace)
        _apply_git_state(repo_row, state)
        await self._session.commit()
        logger.info("Refreshed existing repo => %s", workspace)
        return _row_to_model(repo_row)

    async def _get_repo_row(self, project_id: str) -> RepoRow:
        result = await self._session.execute(
            select(RepoRow).where(RepoRow.project_id == project_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise ValueError(f"Repo record not found for project '{project_id}'")
        return row


def _apply_git_state(row: RepoRow, state: git.GitStatus) -> None:
    row.head_sha = state.head_sha
    row.current_branch = state.current_branch
    row.dirty = state.dirty
    if state.remote_url is not None:
        row.remote_url = state.remote_url
