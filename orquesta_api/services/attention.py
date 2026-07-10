"""Needs-attention aggregation service."""

from __future__ import annotations

from datetime import datetime

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
from orquesta_api.services.runs import _make_executor
from orquesta_api.services.serves import ServeManager

logger = get_logger(__name__)


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
        self._executor = executor if executor is not None else _make_executor()

    async def list(self) -> AttentionResponse:
        """Return all attention items sorted newest-first."""
        result = await self._session.execute(select(ProjectRow))
        projects = list(result.scalars().all())
        items: list[AttentionItem] = []

        for project in projects:
            run_item = await self._failed_run_item(project)
            if run_item is not None:
                items.append(run_item)
            items.extend(await self._task_items(project))

        items.sort(key=lambda item: item.ts, reverse=True)
        return AttentionResponse(items=items)

    async def _failed_run_item(self, project: ProjectRow) -> AttentionItem | None:
        if project.state != "needs_human":
            return None
        result = await self._session.execute(
            select(RunRow)
            .where(RunRow.project_id == project.id, RunRow.state == RunState.failed.value)
            .order_by(
                RunRow.finished_at.desc().nullslast(),
                RunRow.created_at.desc().nullslast(),
                RunRow.id.desc(),
            )
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None

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

    async def _task_items(self, project: ProjectRow) -> list[AttentionItem]:
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
