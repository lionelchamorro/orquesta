"""Project registry CRUD service."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.core.integrations import git
from orquesta_api.db.tables import ProjectRow, RepoRow
from orquesta_api.logger import get_logger
from orquesta_api.services.repos import CloneTargetError, RepoManager, WorkspaceDirtyError
from orquesta_api.services.serves import ServeManager

logger = get_logger(__name__)


def _slugify(name: str) -> str:
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


class ProjectService:
    """CRUD operations for the project registry."""

    def __init__(
        self,
        session: AsyncSession,
        serves: ServeManager | None = None,
    ) -> None:
        self._session = session
        self._serves = serves

    async def create(
        self,
        *,
        name: str,
        repo_url: str | None = None,
        workspace_path: str | None = None,
        base_branch: str,
        description: str | None = None,
        language: str | None = None,
        watch: bool = False,
    ) -> ProjectRow:
        """Register a new project, persisting to projects + repos tables."""
        if repo_url is None and workspace_path is None:
            raise ValueError("Either repo_url or workspace_path must be provided")

        slug = _slugify(name)

        existing = await self._session.get(ProjectRow, slug)
        if existing is not None:
            raise FileExistsError(f"Project with slug '{slug}' already exists")

        if workspace_path is not None:
            dup = await self._session.execute(select(RepoRow).where(RepoRow.root == workspace_path))
            if dup.scalar_one_or_none() is not None:
                raise FileExistsError(f"Workspace path '{workspace_path}' is already registered")
            effective_workspace = workspace_path
            managed = False
        else:
            from orquesta_api.config import settings

            effective_workspace = str(Path(settings.workspaces_dir) / slug)
            managed = True

        project = ProjectRow(
            id=slug,
            name=name,
            repo_url=repo_url,
            workspace_path=effective_workspace,
            base_branch=base_branch,
            watch_prs=watch,
            watch_issues=watch,
            description=description,
            language=language,
        )
        self._session.add(project)

        repo = RepoRow(
            id=slug,
            project_id=slug,
            root=effective_workspace,
            remote_url=repo_url,
            base_branch=base_branch,
            managed=managed,
        )
        self._session.add(repo)

        await self._session.commit()
        await self._session.refresh(project)

        workspace_obj = Path(effective_workspace)
        if repo_url is not None or (workspace_obj.exists() and git.is_git_repo(workspace_obj)):
            try:
                await RepoManager(self._session).ensure(project)
            except Exception as exc:
                # ensure() runs after the project/repo rows were committed above.
                # If the clone/adopt fails, roll the registration back instead of
                # leaving an orphaned project with an empty workspace (this path
                # previously surfaced to the client as an opaque 502).
                await self._session.delete(repo)
                await self._session.delete(project)
                await self._session.commit()
                if managed:
                    shutil.rmtree(effective_workspace, ignore_errors=True)
                if isinstance(exc, CloneTargetError | WorkspaceDirtyError | ValueError):
                    raise
                raise CloneTargetError(
                    f"Could not initialise workspace for '{slug}': {exc}"
                ) from exc

        await self._try_start_serve(slug, project)

        logger.info("Created project => %s", slug)
        return project

    async def _try_start_serve(self, project_id: str, project: ProjectRow) -> None:
        """Attempt to start the orq-lite serve for a newly-created project.

        Failures are logged as warnings and never propagate — serve startup
        is best-effort at registration time.
        """
        if self._serves is None or not project.workspace_path:
            return
        try:
            port = await self._serves.ensure(project_id, project.workspace_path)
            project.serve_port = port
            await self._session.commit()
            await self._session.refresh(project)
        except Exception as exc:
            logger.warning(
                "Could not start serve after project create => project_id=%s error=%s",
                project_id,
                exc,
            )

    async def list(self) -> list[ProjectRow]:
        """Return all registered projects."""
        result = await self._session.execute(select(ProjectRow))
        return list(result.scalars().all())

    async def get(self, id: str) -> ProjectRow:
        """Return the project by id, raising ValueError('not found') if absent."""
        row = await self._session.get(ProjectRow, id)
        if row is None:
            raise ValueError(f"Project '{id}' not found")
        return row

    async def update(self, id: str, **patch: object) -> ProjectRow:
        """Mutate allowed fields (name, base_branch, watch, description) on a project."""
        row = await self.get(id)
        allowed = {"name", "base_branch", "watch", "description"}
        for key, value in patch.items():
            if key not in allowed:
                continue
            if key == "watch":
                row.watch_prs = bool(value)
                row.watch_issues = bool(value)
            else:
                setattr(row, key, value)
        await self._session.commit()
        await self._session.refresh(row)
        return row

    async def delete(self, id: str, prune: bool = False) -> None:
        """Remove the project from the registry, optionally pruning its managed workspace."""
        row = await self.get(id)

        repo_result = await self._session.execute(select(RepoRow).where(RepoRow.project_id == id))
        repo = repo_result.scalar_one_or_none()

        if prune and repo is not None and repo.managed:
            workspace = Path(repo.root)
            if workspace.exists():
                shutil.rmtree(workspace)
                logger.info("Pruned managed workspace => %s", workspace)

        if repo is not None:
            await self._session.delete(repo)

        await self._session.delete(row)
        await self._session.commit()

        if self._serves is not None:
            await self._serves.stop(id)

        logger.info("Deleted project => %s", id)
