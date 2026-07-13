"""Maps GitHub webhook payloads onto flow launches for watched projects."""

import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.tables import ProjectRow, RunRow, WebhookDeliveryRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.models import Run, RunKind
from orquesta_api.services.run_queue import PROCESS_RUN_STATES, canonical_inputs_hash
from orquesta_api.services.runs import RunSupervisor

logger = get_logger(__name__)


def _normalize_repo_url(url: str) -> str:
    """Reduce a repo URL to `host/owner/repo` so https/ssh/.git variants compare equal."""
    normalized = url.strip().lower().removesuffix(".git").removesuffix("/")
    normalized = re.sub(r"^(https?://|git@)", "", normalized)
    if normalized.startswith("github.com:"):
        normalized = normalized.replace(":", "/", 1)
    return normalized


class WatcherService:
    """Dedupes webhook deliveries and launches the matching flow for a watched project."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def is_duplicate_delivery(self, delivery_id: str) -> bool:
        """Record *delivery_id* as seen; return True if it was already processed."""
        existing = await self._session.get(WebhookDeliveryRow, delivery_id)
        if existing is not None:
            return True
        self._session.add(WebhookDeliveryRow(id=delivery_id, received_at=datetime.now(tz=UTC)))
        await self._session.commit()
        return False

    async def _find_watched_project(self, repo: dict[str, Any]) -> ProjectRow | None:
        clone_url = repo.get("clone_url") or repo.get("html_url") or ""
        if not clone_url:
            return None
        target = _normalize_repo_url(clone_url)

        result = await self._session.execute(select(ProjectRow))
        for row in result.scalars():
            if row.repo_url and _normalize_repo_url(row.repo_url) == target:
                return row
        return None

    async def _has_matching_active_or_queued_run(
        self,
        project_id: str,
        flow: str,
        inputs: dict[str, str],
    ) -> bool:
        states = [state.value for state in PROCESS_RUN_STATES]
        states.append("queued")
        result = await self._session.execute(
            select(RunRow.id).where(
                RunRow.project_id == project_id,
                RunRow.state.in_(states),
                RunRow.flow == flow,
                RunRow.inputs_hash == canonical_inputs_hash(inputs),
            )
        )
        return result.scalars().first() is not None

    async def _launch_flow(
        self,
        project_id: str,
        flow: str,
        inputs: dict[str, str],
    ) -> Run | None:
        if await self._has_matching_active_or_queued_run(project_id, flow, inputs):
            logger.info(
                "Skipped webhook launch: identical active or queued run exists => "
                "project_id=%s flow=%s",
                project_id,
                flow,
            )
            return None

        try:
            return await RunSupervisor(self._session).launch(
                project_id,
                kind=RunKind.flow,
                flow=flow,
                inputs=inputs,
                queue=True,
            )
        except IntegrityError:
            await self._session.rollback()
            logger.info(
                "Skipped webhook launch: deduped by queued run uniqueness => project_id=%s flow=%s",
                project_id,
                flow,
            )
            return None

    async def handle_pull_request(self, payload: dict[str, Any]) -> Run | None:
        """PR opened/synchronize + watch.prs -> flow=pr_review. Returns the launched Run, if any."""
        if payload.get("action") not in {"opened", "synchronize"}:
            return None

        project = await self._find_watched_project(payload.get("repository", {}))
        if project is None or not project.watch_prs:
            return None

        pr_number = payload.get("pull_request", {}).get("number") or payload.get("number")
        if pr_number is None:
            return None

        logger.info(
            "GitHub PR event => project_id=%s pr_number=%s action=%s",
            project.id,
            pr_number,
            payload.get("action"),
        )
        return await self._launch_flow(
            project.id,
            flow="pr_review",
            inputs={"pr_number": str(pr_number), "publish": "true"},
        )

    async def handle_issues(self, payload: dict[str, Any]) -> Run | None:
        """Issue opened + watch.issues -> flow=issue_fix. Returns the launched Run, if any."""
        if payload.get("action") != "opened":
            return None

        project = await self._find_watched_project(payload.get("repository", {}))
        if project is None or not project.watch_issues:
            return None

        issue_number = payload.get("issue", {}).get("number")
        if issue_number is None:
            return None

        logger.info("GitHub issue event => project_id=%s issue_number=%s", project.id, issue_number)
        return await self._launch_flow(
            project.id,
            flow="issue_fix",
            inputs={"issue_number": str(issue_number)},
        )
