"""Needs-attention aggregation service."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import (
    AttentionItem,
    AttentionKind,
    AttentionResponse,
    RunHandle,
    RunState,
    TaskStatus,
)
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.run_execution import make_executor
from orquesta_api.services.serves import ServeManager

logger = get_logger(__name__)

# Include failed runs that finished within this window.  Older failures have
# usually been acknowledged; surfacing them would create noise on dashboards
# that have accumulated historical runs.
_FAILED_RUN_WINDOW_DAYS: int = 7


class AttentionService:
    """Collect control-plane and serve signals that need operator attention."""

    def __init__(
        self,
        session: AsyncSession,
        serves: ServeManager,
        client: OrqLiteClient | None = None,
        executor: ExecutorInterface | None = None,
    ) -> None:
        self._session = session
        self._serves = serves
        self._client = client if client is not None else OrqLiteClient()
        self._executor = executor if executor is not None else make_executor()

    async def list(self) -> AttentionResponse:
        """Return all attention items sorted newest-first."""
        result = await self._session.execute(select(ProjectRow))
        projects = list(result.scalars().all())
        items: list[AttentionItem] = []
        projects_by_id = {project.id: project for project in projects}

        # Include recent failed runs for ALL projects, not only those currently
        # in needs_human state.  A project may have been reset to idle after a
        # failed run, but the operator still needs to see the failure.
        failed_runs = await self._failed_runs_for_projects([project.id for project in projects])
        async with asyncio.TaskGroup() as tg:
            failed_run_item_tasks = [
                tg.create_task(self._safe_failed_run_item(projects_by_id[row.project_id], row))
                for row in failed_runs
            ]
            task_item_tasks = [tg.create_task(self._task_items(project)) for project in projects]
        for task in failed_run_item_tasks:
            run_item = task.result()
            if run_item is not None:
                items.append(run_item)
        for task in task_item_tasks:
            items.extend(task.result())

        items.sort(key=lambda item: item.ts, reverse=True)
        return AttentionResponse(items=items)

    async def _failed_runs_for_projects(self, project_ids: Sequence[str]) -> Sequence[RunRow]:
        if not project_ids:
            return []
        cutoff = datetime.now(tz=UTC) - timedelta(days=_FAILED_RUN_WINDOW_DAYS)
        result = await self._session.execute(
            select(RunRow)
            .where(
                RunRow.project_id.in_(project_ids),
                RunRow.state == RunState.failed.value,
                # Limit to runs that finished (or were created) within the window.
                # Use coalesce-style: finished_at if set, otherwise created_at.
                (RunRow.finished_at >= cutoff) | (RunRow.created_at >= cutoff),
            )
            .order_by(
                RunRow.finished_at.desc().nullslast(),
                RunRow.created_at.desc().nullslast(),
                RunRow.id.desc(),
            )
        )
        rows: list[RunRow] = []
        seen_project_ids: set[str] = set()
        for row in result.scalars():
            if row.project_id in seen_project_ids:
                continue
            rows.append(row)
            seen_project_ids.add(row.project_id)
        return rows

    async def _failed_run_item(self, project: ProjectRow, row: RunRow) -> AttentionItem | None:
        detail_parts = [part for part in [row.error, await self._log_tail(row)] if part]
        return AttentionItem(
            kind=AttentionKind.run_failed,
            project_id=project.id,
            project_name=project.name,
            ref=row.id,
            title=f"{row.flow or row.kind} failed",
            detail="\n".join(detail_parts),
            ts=_iso(row.finished_at or row.created_at or project.last_run),
        )

    async def _safe_failed_run_item(self, project: ProjectRow, row: RunRow) -> AttentionItem | None:
        try:
            return await self._failed_run_item(project, row)
        except Exception as exc:
            logger.warning(
                "Could not build failed-run attention item => run_id=%s error=%s",
                row.id,
                exc,
            )
            return None

    async def _log_tail(self, row: RunRow) -> str:
        lines: list[str] = []
        try:
            async for line in self._executor.logs(
                RunHandle(pid=row.pid, container_id=row.container_id, run_id=row.id),
                tail=5,
            ):
                lines.append(line)
        except Exception as exc:
            logger.warning("Could not read run log tail => run_id=%s error=%s", row.id, exc)
        return "\n".join(lines)

    async def _task_items(self, project: ProjectRow) -> Sequence[AttentionItem]:
        aggregator = Aggregator(self._serves, client=self._client)
        try:
            snapshot = await aggregator.snapshot(project.id)
        except Exception as exc:
            logger.warning(
                "Could not fetch attention snapshot => project_id=%s error=%s",
                project.id,
                exc,
            )
            return []

        items: list[AttentionItem] = []
        for task in snapshot.tasks:
            if task.status is TaskStatus.needs_human:
                kind = AttentionKind.task_needs_human
            elif task.status is TaskStatus.needs_clarification:
                kind = AttentionKind.task_needs_clarification
            else:
                continue
            items.append(
                AttentionItem(
                    kind=kind,
                    project_id=project.id,
                    project_name=project.name,
                    ref=task.id,
                    title=task.title,
                    detail=task.failure_reason or "",
                    ts=_iso(project.last_run),
                )
            )
        return items


def _iso(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.isoformat()
