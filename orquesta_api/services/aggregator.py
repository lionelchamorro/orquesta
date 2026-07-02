"""Aggregator service: resolve serve port and proxy orq-lite state."""

from pydantic import BaseModel, Field

from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.logger import get_logger
from orquesta_api.meta.models import Feature, Task
from orquesta_api.services.serves import ServeManager

logger = get_logger(__name__)


class CostSnapshot(BaseModel):
    """Cost data proxied from an orq-lite serve."""

    available: bool = False
    total_usd: float = 0.0


class Snapshot(BaseModel):
    """Merged state snapshot for a project, sourced from an active orq-lite serve."""

    tasks: list[Task] = Field(default_factory=list)
    features: list[Feature] = Field(default_factory=list)
    cost: CostSnapshot = Field(default_factory=CostSnapshot)


class Aggregator:
    """Resolves the serve port for a project and proxies orq-lite state.

    Base URL resolution is delegated entirely to ``ServeManager.port(project_id)``
    so that ``snapshot`` returns gracefully even when no run is active.
    """

    def __init__(
        self,
        serves: ServeManager,
        client: OrqLiteClient | None = None,
    ) -> None:
        self._serves = serves
        self._client = client if client is not None else OrqLiteClient()

    async def snapshot(self, project_id: str) -> Snapshot:
        """Return merged orq-lite state for *project_id*.

        Returns an empty ``Snapshot`` when no serve is running — never raises.
        """
        port = self._serves.port(project_id)
        if port is None:
            logger.info("No active serve => project_id=%s returning empty snapshot", project_id)
            return Snapshot()

        base_url = f"http://127.0.0.1:{port}"
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
        """Return diff text for *task_id* from the orq-lite serve.

        Raises ``ValueError`` (→ 404) when no serve is running.
        """
        base_url = self._require_base_url(project_id)
        return await self._client.get_diff(base_url, task_id)

    async def get_result(self, project_id: str, role: str) -> dict:
        """Return result JSON for *role* from the orq-lite serve.

        Raises ``ValueError`` (→ 404) when no serve is running.
        """
        base_url = self._require_base_url(project_id)
        return await self._client.get_result(base_url, role)

    def _require_base_url(self, project_id: str) -> str:
        port = self._serves.port(project_id)
        if port is None:
            raise ValueError(f"serve not found for project {project_id!r}")
        return f"http://127.0.0.1:{port}"
