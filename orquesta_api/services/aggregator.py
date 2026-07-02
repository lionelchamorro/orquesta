"""Aggregator service: resolve serve port and proxy orq-lite state."""

from pydantic import BaseModel, Field

from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.logger import get_logger
from orquesta_api.meta.models import Feature, Task
from orquesta_api.meta.query_models import (
    AgentRunsPage,
    AttemptDiff,
    CostStats,
    DoctorReport,
    FlowCatalog,
    OrqRunEventsPage,
    OrqRunsPage,
    OrqRunSummary,
)
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

    # ast-grep-ignore: no-dict-return-annotation
    async def get_result(self, project_id: str, role: str) -> dict:
        """Return result JSON for *role* from the orq-lite serve.

        Raises ``ValueError`` (→ 404) when no serve is running.
        """
        base_url = self._require_base_url(project_id)
        return await self._client.get_result(base_url, role)

    # -- query API proxies (docs/orq-lite-query-api.md; requires orq-lite ----
    # -- with the query API — every method 404s when no serve is running -----
    # -- and 502s when the serve predates the endpoints). ---------------------

    async def list_runs(
        self, project_id: str, limit: int = 50, offset: int = 0, active: bool | None = None
    ) -> OrqRunsPage:
        """Proxy GET /api/runs for the project's serve."""
        base_url = self._require_base_url(project_id)
        params: dict = {"limit": limit, "offset": offset}
        if active is not None:
            params["active"] = "true" if active else "false"
        return OrqRunsPage(**await self._client.get_runs(base_url, params))

    async def get_run(self, project_id: str, run_id: str) -> OrqRunSummary:
        """Proxy GET /api/runs/{run_id} for the project's serve."""
        base_url = self._require_base_url(project_id)
        return OrqRunSummary(**await self._client.get_run(base_url, run_id))

    async def get_run_events(
        self,
        project_id: str,
        run_id: str,
        event_type: str | None = None,
        task_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> OrqRunEventsPage:
        """Proxy GET /api/runs/{run_id}/events for the project's serve."""
        base_url = self._require_base_url(project_id)
        params: dict = {"limit": limit, "offset": offset}
        if event_type:
            params["type"] = event_type
        if task_id:
            params["task_id"] = task_id
        return OrqRunEventsPage(**await self._client.get_run_events(base_url, run_id, params))

    async def get_agent_runs(
        self,
        project_id: str,
        run_id: str | None = None,
        task_id: str | None = None,
        role: str | None = None,
        agent: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> AgentRunsPage:
        """Proxy GET /api/agent-runs for the project's serve."""
        base_url = self._require_base_url(project_id)
        params: dict = {"limit": limit, "offset": offset}
        for key, value in (
            ("run_id", run_id),
            ("task_id", task_id),
            ("role", role),
            ("agent", agent),
        ):
            if value:
                params[key] = value
        return AgentRunsPage(**await self._client.get_agent_runs(base_url, params))

    async def get_cost_stats(self, project_id: str, by: str = "run") -> CostStats:
        """Proxy GET /api/stats/cost for the project's serve."""
        base_url = self._require_base_url(project_id)
        return CostStats(**await self._client.get_cost_stats(base_url, by=by))

    async def get_flow_catalog(self, project_id: str) -> FlowCatalog:
        """Proxy GET /api/flows (inputs schema + preflight) for the project's serve."""
        base_url = self._require_base_url(project_id)
        return FlowCatalog(**await self._client.get_flow_catalog(base_url))

    async def get_doctor(self, project_id: str) -> DoctorReport:
        """Proxy GET /api/doctor for the project's serve."""
        base_url = self._require_base_url(project_id)
        return DoctorReport(**await self._client.get_doctor(base_url))

    async def get_attempt_diff(
        self, project_id: str, task_id: str, role: str, cycle: int, attempt: int
    ) -> AttemptDiff:
        """Proxy GET /api/attempt-diff/... (exists since orq-lite v0.2.0)."""
        base_url = self._require_base_url(project_id)
        raw = await self._client.get_attempt_diff(base_url, task_id, role, cycle, attempt)
        return AttemptDiff(**raw)

    def _require_base_url(self, project_id: str) -> str:
        port = self._serves.port(project_id)
        if port is None:
            raise ValueError(f"serve not found for project {project_id!r}")
        return f"http://127.0.0.1:{port}"
