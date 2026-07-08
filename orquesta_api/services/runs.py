"""Run lifecycle service: launch, stop, inspect, and list runs."""

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orquesta_api.config import settings
from orquesta_api.db.session import SessionLocal
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import EventKind, Run, RunEvent, RunHandle, RunKind, RunSpec, RunState
from orquesta_api.services.events import EventBus, get_event_bus
from orquesta_api.services.examples_overlay import overlay_examples

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
        orq_run_id=row.orq_run_id,
    )


def _build_handle(row: RunRow) -> RunHandle:
    return RunHandle(
        pid=row.pid, api_port=row.api_port, container_id=row.container_id, run_id=row.id
    )


# States for which the executor is still the source of truth about liveness.
_ACTIVE_RUN_STATES = frozenset(
    {RunState.queued, RunState.starting, RunState.running, RunState.stopping}
)


_LOCAL_EXECUTOR: ExecutorInterface | None = None
_DOCKER_EXECUTOR: ExecutorInterface | None = None


def _make_executor() -> ExecutorInterface:
    # Both backends keep live state in memory (local: process handles/log
    # buffers; docker: a shared DockerClient), so each must be a process-wide
    # singleton: /logs and /stop run in later requests and need the same
    # instance that launched the run. (Assumes a single uvicorn worker, which
    # is how the container runs it.)
    global _LOCAL_EXECUTOR, _DOCKER_EXECUTOR
    if settings.run_executor == "local":
        from orquesta_api.executors.local import LocalExecutor

        if _LOCAL_EXECUTOR is None:
            _LOCAL_EXECUTOR = LocalExecutor()
        return _LOCAL_EXECUTOR
    if settings.run_executor == "docker":
        from orquesta_api.executors.docker import DockerExecutor

        if _DOCKER_EXECUTOR is None:
            _DOCKER_EXECUTOR = DockerExecutor()
        return _DOCKER_EXECUTOR
    raise ValueError(f"Unknown executor '{settings.run_executor}'")


async def ensure_workspace_ready(workspace: str, bin_path: str) -> None:
    """Run ``orq-lite init`` in *workspace* if ``team.json`` is absent.

    A fresh clone has no ``team.json`` / ``flows.json`` / ``prompts/`` and every
    orq-lite command would fail at ``config.Load``.  ``init`` is non-destructive
    (it does not overwrite existing config), so it is safe to call idempotently.

    Raises:
        RuntimeError: if ``orq-lite init`` exits with a non-zero code (→502).
    """
    if not (Path(workspace) / "team.json").exists():
        logger.info("Initialising workspace => path=%s", workspace)
        proc = await asyncio.create_subprocess_exec(
            bin_path,
            "init",
            cwd=workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        exit_code = await proc.wait()
        if exit_code != 0:
            raise RuntimeError(
                f"orq-lite init failed (exit {exit_code}) in workspace {workspace!r}"
            )

    # Add the shipped example flows (factory_governed, pr_review, issue_fix) and
    # their roles/prompts on top of the base config. Idempotent.
    overlay_examples(workspace)


# ---------------------------------------------------------------------------
# Background task registry — prevents garbage-collection of in-flight tasks.
# asyncio.create_task() result must be held by a strong reference for the life
# of the task, or it can be GC'd mid-flight (documented asyncio gotcha).
# ---------------------------------------------------------------------------

_SUPERVISOR_TASKS: set[asyncio.Task[None]] = set()


def _track(task: asyncio.Task[None]) -> None:
    """Register a task so it is not garbage-collected before it completes."""
    _SUPERVISOR_TASKS.add(task)
    task.add_done_callback(_SUPERVISOR_TASKS.discard)


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
        self._executor = executor if executor is not None else _make_executor()
        # session_maker used by background _supervise tasks (never the request session).
        self._session_maker = session_maker if session_maker is not None else SessionLocal
        self._events = events if events is not None else get_event_bus()

    @property
    def executor(self) -> ExecutorInterface:
        """Return the executor backing this supervisor."""
        return self._executor

    async def launch(
        self,
        project_id: str,
        kind: RunKind,
        plan_path: str | None = None,
        flow: str | None = None,
        inputs: dict[str, str] | None = None,
        args: list[str] | None = None,
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

        # Reject concurrent launches for the same project.
        existing = await self._session.execute(
            select(RunRow).where(
                RunRow.project_id == project_id,
                RunRow.state.in_([s.value for s in _ACTIVE_RUN_STATES]),
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise FileExistsError(f"Project '{project_id}' already has an active run")

        workspace = project.workspace_path or ""
        await ensure_workspace_ready(workspace, settings.orq_lite_bin)

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
            workspace_path=workspace,
            kind=kind,
            plan_path=plan_path,
            flow=flow,
            inputs=inputs or {},
            args=args or [],
            watch_prs=project.watch_prs,
            watch_issues=project.watch_issues,
        )

        handle: RunHandle = await self._executor.start(spec, run_id=run_id)

        row.pid = handle.pid
        row.api_port = handle.api_port
        row.container_id = handle.container_id
        row.started_at = datetime.now(tz=UTC)
        row.state = RunState.running.value
        # A foreground run marks the project running so the UI disables the flow
        # launcher while it executes. A watch daemon is a long-lived background
        # supervisor — it must NOT, or the launcher would stay disabled for its
        # whole life. stop()/_supervise reset the project when the run ends.
        if kind is not RunKind.watch:
            project.state = "running"

        await self._session.commit()

        # Launch background supervision task; hold a strong reference so it
        # is not garbage-collected before it writes the terminal state.
        if handle.pid is not None:
            task = asyncio.create_task(self._supervise(run_id, handle.pid))
            _track(task)

        await self._emit_lifecycle(row, EventKind.run_started, status=kind.value)
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

    async def get_stream_context(self, run_id: str) -> tuple[Run, RunHandle]:
        """Return (run_model, handle) for log streaming; raises ValueError if not found."""
        row = await self._get_row(run_id)
        return _row_to_model(row), _build_handle(row)

    async def stop(self, run_id: str) -> Run:
        """Stop a running process and persist the terminal state.

        Uses the real exit code rather than hardcoding exit_code=1.  Sets state
        to ``cancelled`` only when stop() is what actually terminated the process;
        if the process had already exited naturally, uses the real outcome.
        """
        row = await self._get_row(run_id)

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
        if RunState(row.state) not in _ACTIVE_RUN_STATES or row.pid is None:
            return
        live = await self._executor.status(_build_handle(row))
        if live in (RunState.succeeded, RunState.failed):
            row.state = live.value
            row.exit_code = 0 if live is RunState.succeeded else 1
            row.finished_at = datetime.now(tz=UTC)
            await self._session.commit()
            await self._emit_lifecycle(row, EventKind.run_finished, status=live.value)

    async def reconcile(self) -> None:
        """Mark all active RunRows as failed if the executor has no live process for them.

        Called at API startup.  Since LocalExecutor starts with an empty
        ``_processes`` dict (pids do not survive an API restart), every
        previously-active run is definitionally orphaned.  Future executor
        implementations that CAN restore state will return a non-failed status
        from ``executor.status()`` and are left untouched.
        """
        result = await self._session.execute(
            select(RunRow).where(RunRow.state.in_([s.value for s in _ACTIVE_RUN_STATES]))
        )
        rows = result.scalars().all()
        if not rows:
            return

        now = datetime.now(tz=UTC)
        count = 0
        for row in rows:
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

        if count:
            await self._session.commit()
        logger.info("Startup reconciliation: %d orphaned run(s) marked failed", count)

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
