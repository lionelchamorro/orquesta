"""Per-project run queue helpers."""

import asyncio
import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.config import settings
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import EventKind, RunEvent, RunKind, RunSpec, RunState
from orquesta_api.services.events import EventBus

_PROCESS_RUN_STATES = frozenset({RunState.starting, RunState.running, RunState.stopping})

EnsureWorkspace = Callable[[str, str], Awaitable[None]]
SuperviseRun = Callable[[str, int], Awaitable[None]]
TrackTask = Callable[[asyncio.Task[None]], None]


def canonical_inputs_hash(inputs: Mapping[str, object] | None) -> str:
    """Return a stable hash for run inputs, independent of JSON key order."""
    payload = json.dumps(inputs or {}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def build_run_row(
    *,
    project_id: str,
    kind: RunKind,
    state: RunState,
    plan_path: str | None,
    flow: str | None,
    inputs: dict[str, str] | None,
    args: list[str] | None,
    queued_at: datetime | None = None,
) -> RunRow:
    """Build a persisted RunRow with stored launch parameters."""
    return RunRow(
        id=str(uuid.uuid4()),
        project_id=project_id,
        kind=kind.value,
        state=state.value,
        executor=settings.run_executor,
        created_at=datetime.now(tz=UTC),
        queued_at=queued_at,
        flow=flow,
        inputs=inputs or {},
        inputs_hash=canonical_inputs_hash(inputs),
        plan_path=plan_path,
        args=args or [],
    )


async def queue_run(
    session: AsyncSession,
    project_id: str,
    kind: RunKind,
    plan_path: str | None,
    flow: str | None,
    inputs: dict[str, str] | None,
    args: list[str] | None,
) -> RunRow:
    """Persist a queued run without starting an executor process."""
    row = build_run_row(
        project_id=project_id,
        kind=kind,
        state=RunState.queued,
        plan_path=plan_path,
        flow=flow,
        inputs=inputs,
        args=args,
        queued_at=datetime.now(tz=UTC),
    )
    session.add(row)
    await session.commit()
    return row


async def start_run_row(
    session: AsyncSession,
    executor: ExecutorInterface,
    events: EventBus,
    row: RunRow,
    project: ProjectRow,
    workspace: str,
    supervise: SuperviseRun,
    track: TrackTask,
) -> None:
    """Start a persisted run row using its stored launch parameters."""
    kind = RunKind(row.kind)
    spec = RunSpec(
        project_id=row.project_id,
        workspace_path=workspace,
        kind=kind,
        plan_path=row.plan_path,
        flow=row.flow,
        inputs=row.inputs or {},
        args=row.args or [],
        watch_prs=project.watch_prs,
        watch_issues=project.watch_issues,
    )
    handle = await executor.start(spec, run_id=row.id)

    row.pid = handle.pid
    row.api_port = handle.api_port
    row.container_id = handle.container_id
    row.started_at = datetime.now(tz=UTC)
    row.state = RunState.running.value
    if kind is not RunKind.watch:
        project.state = "running"

    await session.commit()

    if handle.pid is not None:
        task = asyncio.create_task(supervise(row.id, handle.pid))
        track(task)

    await events.publish(
        RunEvent(
            ts=datetime.now(tz=UTC).isoformat(),
            event=EventKind.run_started,
            project=row.project_id,
            run_id=row.id,
            status=kind.value,
        )
    )


async def start_oldest_queued(
    session: AsyncSession,
    executor: ExecutorInterface,
    events: EventBus,
    project_id: str,
    ensure_workspace_ready: EnsureWorkspace,
    supervise: SuperviseRun,
    track: TrackTask,
) -> None:
    """Start the oldest queued run for a project with no active process."""
    project = await session.get(ProjectRow, project_id)
    if project is None or project.state not in {"idle", "needs_human"}:
        return

    active = await session.execute(
        select(RunRow).where(
            RunRow.project_id == project_id,
            RunRow.state.in_([state.value for state in _PROCESS_RUN_STATES]),
        )
    )
    if active.scalar_one_or_none() is not None:
        return

    result = await session.execute(
        select(RunRow)
        .where(RunRow.project_id == project_id, RunRow.state == RunState.queued.value)
        .order_by(
            RunRow.queued_at.asc().nullsfirst(),
            RunRow.created_at.asc().nullsfirst(),
            RunRow.id.asc(),
        )
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return

    claimed = await session.execute(
        update(RunRow)
        .where(RunRow.id == row.id, RunRow.state == RunState.queued.value)
        .values(state=RunState.starting.value)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        return

    row.state = RunState.starting.value
    workspace = project.workspace_path or ""
    await ensure_workspace_ready(workspace, settings.orq_lite_bin)
    await start_run_row(session, executor, events, row, project, workspace, supervise, track)
