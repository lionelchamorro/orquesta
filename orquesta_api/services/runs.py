"""Run lifecycle service: launch, stop, inspect, and list runs."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.config import settings
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Run, RunHandle, RunKind, RunSpec, RunState

logger = get_logger(__name__)


def _row_to_model(row: RunRow) -> Run:
    return Run(
        id=row.id,
        project_id=row.project_id,
        kind=RunKind(row.kind),
        state=RunState(row.state),
        executor=row.executor,
        container_id=row.container_id,
        pid=row.pid,
        api_port=row.api_port,
        started_at=row.started_at,
        finished_at=row.finished_at,
        exit_code=row.exit_code,
        base_sha=row.base_sha,
        head_sha=row.head_sha,
        error=row.error,
    )


def _build_handle(row: RunRow) -> RunHandle:
    return RunHandle(pid=row.pid, api_port=row.api_port, container_id=row.container_id)


# States for which the executor is still the source of truth about liveness.
_ACTIVE_RUN_STATES = frozenset(
    {RunState.queued, RunState.starting, RunState.running, RunState.stopping}
)


_LOCAL_EXECUTOR: ExecutorInterface | None = None


def _make_executor() -> ExecutorInterface:
    # The local executor keeps live process + log-buffer state in memory, so it
    # must be a process-wide singleton: /logs and /stop run in later requests
    # and need the same instance that launched the process. (Assumes a single
    # uvicorn worker, which is how the container runs it.)
    global _LOCAL_EXECUTOR
    if settings.run_executor == "local":
        from orquesta_api.executors.local import LocalExecutor

        if _LOCAL_EXECUTOR is None:
            _LOCAL_EXECUTOR = LocalExecutor()
        return _LOCAL_EXECUTOR
    raise ValueError(f"Unknown executor '{settings.run_executor}'")


class RunSupervisor:
    """Run lifecycle operations for registered projects."""

    def __init__(self, session: AsyncSession, executor: ExecutorInterface | None = None) -> None:
        self._session = session
        self._executor = executor if executor is not None else _make_executor()

    @property
    def executor(self) -> ExecutorInterface:
        """Return the executor backing this supervisor."""
        return self._executor

    async def launch(
        self,
        project_id: str,
        kind: RunKind,
        plan_path: str | None = None,
        serve: bool = True,
        args: list[str] | None = None,
    ) -> Run:
        """Start a new run for the project and return a Run in the running state."""
        project = await self._session.get(ProjectRow, project_id)
        if project is None:
            raise ValueError(f"Project '{project_id}' not found")

        run_id = str(uuid.uuid4())
        row = RunRow(
            id=run_id,
            project_id=project_id,
            kind=kind.value,
            state=RunState.queued.value,
            executor=settings.run_executor,
        )
        self._session.add(row)
        await self._session.flush()

        row.state = RunState.starting.value

        spec = RunSpec(
            project_id=project_id,
            workspace_path=project.workspace_path or "",
            kind=kind,
            serve=serve,
            plan_path=plan_path,
            args=args or [],
        )

        handle: RunHandle = await self._executor.start(spec)

        row.pid = handle.pid
        row.api_port = handle.api_port
        row.container_id = handle.container_id
        row.started_at = datetime.now(tz=UTC)
        row.state = RunState.running.value

        await self._session.commit()
        self._emit_event(run_id, "launched")
        return _row_to_model(row)

    async def get_stream_context(self, run_id: str) -> tuple[Run, RunHandle]:
        """Return (run_model, handle) for log streaming; raises ValueError if not found."""
        row = await self._get_row(run_id)
        return _row_to_model(row), _build_handle(row)

    async def stop(self, run_id: str) -> Run:
        """Stop a running process and persist the terminal state."""
        row = await self._get_row(run_id)
        handle = _build_handle(row)

        row.state = RunState.stopping.value
        await self._session.flush()

        await self._executor.stop(handle)
        live_state = await self._executor.status(handle)

        if live_state == RunState.succeeded:
            row.state = RunState.succeeded.value
            row.exit_code = 0
        else:
            # Process exited non-zero (or before our stop arrived) — treat as cancelled.
            row.state = RunState.cancelled.value
            row.exit_code = 1

        row.finished_at = datetime.now(tz=UTC)
        await self._session.commit()
        self._emit_event(run_id, "stopped")
        return _row_to_model(row)

    async def get(self, run_id: str) -> Run:
        """Return the run by id, reconciling a stale active state with the executor."""
        row = await self._get_row(run_id)
        await self._reconcile(row)
        return _row_to_model(row)

    async def _reconcile(self, row: RunRow) -> None:
        """Transition a row the DB still calls active to its terminal state.

        The executor holds live process state; nothing pushes a run to
        succeeded/failed when the process exits, so runs would otherwise stay
        'running' forever. Ask the executor and persist a terminal outcome.
        """
        if RunState(row.state) not in _ACTIVE_RUN_STATES or row.pid is None:
            return
        live = await self._executor.status(_build_handle(row))
        if live in (RunState.succeeded, RunState.failed):
            row.state = live.value
            row.exit_code = 0 if live is RunState.succeeded else 1
            row.finished_at = datetime.now(tz=UTC)
            await self._session.commit()
            self._emit_event(row.id, live.value)

    async def list(
        self,
        project_id: str | None = None,
        state: RunState | None = None,
    ) -> list[Run]:
        """Return runs with optional project_id and state filters."""
        q = select(RunRow)
        if project_id is not None:
            q = q.where(RunRow.project_id == project_id)
        if state is not None:
            q = q.where(RunRow.state == state.value)
        result = await self._session.execute(q)
        return [_row_to_model(r) for r in result.scalars().all()]

    async def _get_row(self, run_id: str) -> RunRow:
        row = await self._session.get(RunRow, run_id)
        if row is None:
            raise ValueError(f"Run '{run_id}' not found")
        return row

    def _emit_event(self, run_id: str, event: str) -> None:
        logger.info("Run event => run_id=%s event=%s (stubbed until EventBus slice)", run_id, event)
