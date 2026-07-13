"""Run lifecycle service: launch, stop, inspect, and list runs."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orquesta_api.config import settings
from orquesta_api.db.session import SessionLocal
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import EventKind, Run, RunEvent, RunHandle, RunKind, RunState
from orquesta_api.services.events import EventBus, get_event_bus
from orquesta_api.services.run_execution import ensure_workspace_ready, make_executor
from orquesta_api.services.run_models import build_handle as _build_handle
from orquesta_api.services.run_models import row_to_model as _row_to_model
from orquesta_api.services.run_queue import (
    PROCESS_RUN_STATES,
    build_run_row,
    queue_run,
    start_oldest_queued,
    start_run_row,
)
from orquesta_api.services.run_tasks import SUPERVISOR_TASKS as _SUPERVISOR_TASKS  # noqa: F401
from orquesta_api.services.run_tasks import track as _track

logger = get_logger(__name__)


# States for which the executor is still the source of truth about liveness.
_ACTIVE_RUN_STATES = frozenset(
    {RunState.queued, RunState.starting, RunState.running, RunState.stopping}
)


class RunSupervisor:
    """Run lifecycle operations for registered projects."""

    def __init__(
        self,
        session: AsyncSession,
        executor: ExecutorInterface | None = None,
        session_maker: async_sessionmaker[AsyncSession] | None = None,
        events: EventBus | None = None,
    ) -> None:
        self._session = session
        self._executor = executor if executor is not None else make_executor()
        # session_maker used by background _supervise tasks (never the request session).
        self._session_maker = session_maker if session_maker is not None else SessionLocal
        self._events = events if events is not None else get_event_bus()

    @property
    def executor(self) -> ExecutorInterface:
        """Return the executor backing this supervisor."""
        return self._executor

    async def _drain_queue(self, project_id: str, run_id: str | None, context: str) -> None:
        """Start a queued run, logging and preserving queue state if drain fails."""
        try:
            async with self._session_maker() as session:
                await start_oldest_queued(
                    session,
                    self._executor,
                    self._events,
                    project_id,
                    ensure_workspace_ready,
                    self._supervise,
                    _track,
                )
        except Exception as exc:
            logger.exception(
                "Queue drain failed => project_id=%s run_id=%s context=%s error=%s",
                project_id,
                run_id,
                context,
                exc,
            )

    async def launch(
        self,
        project_id: str,
        kind: RunKind,
        plan_path: str | None = None,
        flow: str | None = None,
        inputs: dict[str, str] | None = None,
        args: list[str] | None = None,
        queue: bool = True,
    ) -> Run:
        """Start a new run for the project and return a Run in the running state.

        Raises:
            ValueError: if *project_id* is not registered (→404).
            FileExistsError: if the project already has an active run (→409).
            RuntimeError: if workspace initialisation fails (→502).
        """
        project = await self._session.get(ProjectRow, project_id)
        if project is None:
            raise ValueError(f"Project '{project_id}' not found")

        # A watch run with neither target enabled would watch nothing, exit, and
        # get the project flipped to needs_human. Reject before creating a row.
        if kind is RunKind.watch and not (project.watch_prs or project.watch_issues):
            raise ValueError(
                f"Project '{project_id}' has no watch targets enabled "
                "(set watch.prs and/or watch.issues)"
            )

        # Queue behind a process-active run or existing backlog, preserving FIFO admission.
        existing = await self._session.execute(
            select(RunRow).where(
                RunRow.project_id == project_id,
                RunRow.state.in_([RunState.queued.value, *[s.value for s in PROCESS_RUN_STATES]]),
            )
        )
        if existing.scalars().first() is not None:
            if queue:
                return _row_to_model(
                    await queue_run(self._session, project_id, kind, plan_path, flow, inputs, args)
                )
            raise FileExistsError(f"Project '{project_id}' already has an active run")

        workspace = project.workspace_path or ""
        await ensure_workspace_ready(workspace, settings.orq_lite_bin)

        row = build_run_row(
            project_id=project_id,
            kind=kind,
            state=RunState.starting,
            plan_path=plan_path,
            flow=flow,
            inputs=inputs,
            args=args,
        )
        self._session.add(row)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            if queue:
                return _row_to_model(
                    await queue_run(self._session, project_id, kind, plan_path, flow, inputs, args)
                )
            raise FileExistsError(f"Project '{project_id}' already has an active run") from exc

        await start_run_row(
            self._session,
            self._executor,
            self._events,
            row,
            project,
            workspace,
            self._supervise,
            _track,
        )
        return _row_to_model(row)

    async def _supervise(self, run_id: str, pid: int) -> None:
        """Await process exit and persist the real terminal state.

        Uses its own session — never ``self._session``, which is request-scoped
        and may be closed by the time the process exits.
        """
        handle = RunHandle(pid=pid, run_id=run_id)
        exit_code = await self._executor.wait(handle)

        async with self._session_maker() as session:
            row = await session.get(RunRow, run_id)
            if row is None:
                logger.warning("_supervise: RunRow %s not found; skipping", run_id)
                return

            # stop() marks the row stopping (then cancelled) before killing the
            # process, so a SIGTERM exit is a user cancellation, not a failure.
            stopped = RunState(row.state) in (RunState.stopping, RunState.cancelled)

            # A natural terminal state (succeeded/failed) was already written by a
            # prior call — respect it. A stop-in-progress still needs finalizing.
            if RunState(row.state) not in _ACTIVE_RUN_STATES and not stopped:
                logger.info(
                    "_supervise: run %s already terminal (state=%s); skipping",
                    run_id,
                    row.state,
                )
                return

            now = datetime.now(tz=UTC)
            row.exit_code = exit_code
            row.finished_at = now
            if stopped:
                row.state = RunState.cancelled.value
                project_state = "idle"
            else:
                row.state = RunState.succeeded.value if exit_code == 0 else RunState.failed.value
                project_state = "idle" if exit_code == 0 else "needs_human"
            final_state = row.state

            project = await session.get(ProjectRow, row.project_id)
            if project is not None:
                project.last_run = now
                project.state = project_state

            await session.commit()

        await self._emit_lifecycle(row, EventKind.run_finished, status=final_state)
        logger.info("_supervise: run %s finished => exit_code=%s", run_id, exit_code)
        await self._drain_queue(row.project_id, run_id, "_supervise")

    async def get_stream_context(self, run_id: str) -> tuple[Run, RunHandle]:
        """Return (run_model, handle) for log streaming; raises ValueError if not found."""
        row = await self._get_row(run_id)
        return _row_to_model(row), _build_handle(row)

    async def retry(self, run_id: str, feedback: str | None = None) -> Run:
        """Relaunch a finished run using its persisted launch parameters."""
        row = await self._get_row(run_id)
        if RunState(row.state) in _ACTIVE_RUN_STATES:
            raise ValueError(f"Run '{run_id}' is not finished")
        kind = RunKind(row.kind)
        if kind is RunKind.flow and not row.flow:
            raise ValueError(f"Run '{run_id}' is missing persisted flow launch parameters")
        if kind is RunKind.plan and not row.plan_path:
            raise ValueError(f"Run '{run_id}' is missing persisted plan launch parameters")
        inputs = dict(row.inputs or {})
        if feedback:
            inputs["feedback"] = feedback
        return await self.launch(
            row.project_id,
            kind=kind,
            plan_path=row.plan_path,
            flow=row.flow,
            inputs=inputs,
            args=row.args or [],
            queue=True,
        )

    async def stop(self, run_id: str) -> Run:
        """Stop a running process and persist the terminal state.

        Uses the real exit code rather than hardcoding exit_code=1.  Sets state
        to ``cancelled`` only when stop() is what actually terminated the process;
        if the process had already exited naturally, uses the real outcome.
        """
        row = await self._get_row(run_id)

        # A queued run has no process; cancel it directly and drain the queue.
        if RunState(row.state) is RunState.queued:
            project_id = row.project_id
            row.state = RunState.cancelled.value
            row.finished_at = datetime.now(tz=UTC)
            await self._session.commit()
            await self._emit_lifecycle(row, EventKind.run_finished, status=row.state)
            await self._drain_queue(project_id, run_id, "stop")
            return _row_to_model(row)

        # If _supervise already finalized the row, return current state.
        if RunState(row.state) not in _ACTIVE_RUN_STATES:
            return _row_to_model(row)

        handle = _build_handle(row)

        # Snapshot liveness BEFORE we attempt to stop — determines cancelled vs real.
        live_state_before = await self._executor.status(handle)
        was_running = live_state_before not in (RunState.succeeded, RunState.failed)

        row.state = RunState.stopping.value
        # Commit (not just flush) so _supervise's separate session observes the
        # stopping marker and treats the resulting SIGTERM exit as a user
        # cancellation (→ project idle) rather than a failure (→ needs_human).
        await self._session.commit()

        await self._executor.stop(handle)

        # Re-read from DB: _supervise may have committed a terminal state concurrently.
        await self._session.refresh(row)
        if RunState(row.state) not in _ACTIVE_RUN_STATES:
            # _supervise beat us to it — respect its write.
            return _row_to_model(row)

        exit_code = await self._executor.wait(handle)

        if was_running:
            # We initiated the termination → cancelled.
            row.state = RunState.cancelled.value
        else:
            # Process had already exited before stop() was called → real outcome.
            row.state = RunState.succeeded.value if exit_code == 0 else RunState.failed.value

        row.exit_code = exit_code
        row.finished_at = datetime.now(tz=UTC)
        await self._session.commit()
        await self._emit_lifecycle(row, EventKind.run_finished, status=row.state)
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
        if RunState(row.state) not in PROCESS_RUN_STATES or row.pid is None:
            return
        live = await self._executor.status(_build_handle(row))
        if live in (RunState.succeeded, RunState.failed):
            row.state = live.value
            row.exit_code = 0 if live is RunState.succeeded else 1
            finished_at = datetime.now(tz=UTC)
            row.finished_at = finished_at
            project = await self._session.get(ProjectRow, row.project_id)
            if project is not None:
                project.last_run = finished_at
                project.state = "idle" if live is RunState.succeeded else "needs_human"
            await self._session.commit()
            await self._emit_lifecycle(row, EventKind.run_finished, status=live.value)
            await self._drain_queue(row.project_id, row.id, "_reconcile")

    async def reconcile(self) -> None:
        """Mark all active RunRows as failed if the executor has no live process for them.

        Called at API startup.  Since LocalExecutor starts with an empty
        ``_processes`` dict (pids do not survive an API restart), every
        previously-active run is definitionally orphaned.  Future executor
        implementations that CAN restore state will return a non-failed status
        from ``executor.status()`` and are left untouched.
        """
        result = await self._session.execute(
            select(RunRow).where(RunRow.state.in_([s.value for s in PROCESS_RUN_STATES]))
        )
        now = datetime.now(tz=UTC)
        count = 0
        for row in result.scalars().all():
            live = await self._executor.status(_build_handle(row))
            if live not in (RunState.succeeded, RunState.failed):
                # Executor claims still running; leave it alone.
                continue

            row.state = RunState.failed.value
            row.error = "orphaned by control-plane restart"
            row.finished_at = now

            project = await self._session.get(ProjectRow, row.project_id)
            if project is not None:
                project.state = "needs_human"
                project.last_run = now
            count += 1

        await self._session.commit()
        logger.info("Startup reconciliation: %d orphaned run(s) marked failed", count)

        projects = await self._session.execute(
            select(ProjectRow.id).where(ProjectRow.state.in_(["idle", "needs_human"]))
        )
        for project_id in projects.scalars().all():
            await self._drain_queue(project_id, None, "reconcile")

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

    async def _emit_lifecycle(self, row: RunRow, kind: EventKind, **extra: str) -> None:
        """Publish a run_started/run_finished event stamped with the run's project."""
        await self._events.publish(
            RunEvent(
                ts=datetime.now(tz=UTC).isoformat(),
                event=kind,
                project=row.project_id,
                run_id=row.id,
                **extra,
            )
        )
