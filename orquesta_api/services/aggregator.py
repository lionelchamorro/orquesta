"""Aggregator service: resolve active run and proxy orq-lite state."""

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.db.tables import RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.models import Feature, RunState, Task

logger = get_logger(__name__)


class CostSnapshot(BaseModel):
    """Cost data proxied from an orq-lite run."""

    available: bool = False
    total_usd: float = 0.0


class Snapshot(BaseModel):
    """Merged state snapshot for a project, sourced from an active orq-lite run."""

    tasks: list[Task] = Field(default_factory=list)
    features: list[Feature] = Field(default_factory=list)
    cost: CostSnapshot = Field(default_factory=CostSnapshot)


class Aggregator:
    """Resolves the active run for a project and proxies orq-lite state."""

    def __init__(
        self,
        session: AsyncSession,
        client: OrqLiteClient | None = None,
    ) -> None:
        self._session = session
        self._client = client if client is not None else OrqLiteClient()

    async def snapshot(self, project_id: str) -> Snapshot:
        """Return merged orq-lite state for project_id, or empty snapshot if no active run."""
        row = await self._active_run(project_id)
        if row is None:
            logger.info("No active run => project_id=%s returning empty snapshot", project_id)
            return Snapshot()

        base_url = self._base_url(row)
        logger.info("Fetching snapshot => project_id=%s base_url=%s", project_id, base_url)

        tasks_resp = await self._client.get_tasks(base_url)
        factory_resp = await self._client.get_factory(base_url)
        cost_resp = await self._client.get_cost(base_url)

        return Snapshot(
            tasks=[Task(**t) for t in tasks_resp.get("tasks", [])],
            features=[Feature(**f) for f in factory_resp.get("features", [])],
            cost=CostSnapshot(
                available=cost_resp.get("available", False),
                total_usd=cost_resp.get("total_usd", 0.0),
            ),
        )

    async def get_diff(self, project_id: str, task_id: str) -> str:
        """Return diff text for task_id from the active orq-lite run, or raise if none."""
        row = await self._require_active_run(project_id)
        return await self._client.get_diff(self._base_url(row), task_id)

    async def get_result(self, project_id: str, role: str) -> dict:
        """Return result JSON for role from the active orq-lite run, or raise if none."""
        row = await self._require_active_run(project_id)
        return await self._client.get_result(self._base_url(row), role)

    def _base_url(self, row: RunRow) -> str:
        return f"http://127.0.0.1:{row.api_port}"

    async def _require_active_run(self, project_id: str) -> RunRow:
        row = await self._active_run(project_id)
        if row is None:
            raise ValueError(f"active run not found for project {project_id!r}")
        return row

    async def _active_run(self, project_id: str) -> RunRow | None:
        result = await self._session.execute(
            select(RunRow).where(
                RunRow.project_id == project_id,
                RunRow.state == RunState.running.value,
            )
        )
        return result.scalar_one_or_none()
