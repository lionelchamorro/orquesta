"""Tests for queueing launches behind active runs and stopping queued runs."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from queue_fakes import BlockingStartExecutor, QueueExecutor, wait_for_supervisor_tasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base, ProjectRow, RunRow
from orquesta_api.meta.models import RunKind, RunState
from orquesta_api.services import runs as runs_module
from orquesta_api.services.events import EventBus
from orquesta_api.services.run_queue import canonical_inputs_hash, start_oldest_queued
from orquesta_api.services.runs import RunSupervisor


async def test_launch_queues_behind_active_run(db, project: str) -> None:
    executor = QueueExecutor()
    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="first")
        queued = await svc.launch(
            project,
            kind=RunKind.flow,
            flow="second",
            inputs={"ticket": "123"},
        )

    assert active.state == RunState.running
    assert queued.state == RunState.queued
    assert queued.pid is None
    assert len(executor.started) == 1

    async with db() as session:
        row = await session.get(RunRow, queued.id)
        assert row is not None
        assert row.flow == "second"
        assert row.inputs == {"ticket": "123"}
        assert row.queued_at is not None

    assert active.pid is not None
    executor.finish(active.pid)
    await wait_for_supervisor_tasks()


async def test_launch_queues_behind_existing_queued_run_when_no_process_active(
    db, project: str
) -> None:
    executor = QueueExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add(
            RunRow(
                id="older-queued",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.queued.value,
                executor="local",
                flow="older",
                inputs={"ticket": "1"},
                inputs_hash=canonical_inputs_hash({"ticket": "1"}),
                created_at=now,
                queued_at=now,
            )
        )
        await session.commit()

        svc = RunSupervisor(session, executor=executor, session_maker=db)
        launched = await svc.launch(
            project,
            kind=RunKind.flow,
            flow="newer",
            inputs={"ticket": "2"},
            queue=True,
        )

    assert launched.state == RunState.queued
    assert launched.pid is None
    assert executor.started == {}

    async with db() as session:
        rows = await session.execute(
            select(RunRow)
            .where(RunRow.project_id == project, RunRow.state == RunState.queued.value)
            .order_by(RunRow.queued_at.asc(), RunRow.created_at.asc())
        )
        assert [row.flow for row in rows.scalars().all()] == ["older", "newer"]


async def test_concurrent_drains_claim_oldest_queued_run_once(tmp_path: Path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'drain-race.sqlite'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db: async_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    project = "proj1"
    executor = BlockingStartExecutor()
    now = datetime.now(tz=UTC)
    try:
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        async with db() as session:
            session.add(ProjectRow(id=project, name="Project", workspace_path=str(workspace)))
            session.add(
                RunRow(
                    id="queued-once",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="issue_fix",
                    inputs={"issue_number": "7"},
                    inputs_hash=canonical_inputs_hash({"issue_number": "7"}),
                    created_at=now,
                    queued_at=now,
                )
            )
            await session.commit()

        async def ensure_ready(_workspace: str, _bin_path: str) -> None:
            return None

        async def supervise(_run_id: str, _pid: int) -> None:
            return None

        async with db() as session_a, db() as session_b:
            task_a = asyncio.create_task(
                start_oldest_queued(
                    session_a,
                    executor,
                    EventBus(),
                    project,
                    ensure_ready,
                    supervise,
                    runs_module._track,
                )
            )
            await asyncio.wait_for(executor.first_start_entered.wait(), timeout=1)
            task_b = asyncio.create_task(
                start_oldest_queued(
                    session_b,
                    executor,
                    EventBus(),
                    project,
                    ensure_ready,
                    supervise,
                    runs_module._track,
                )
            )
            await asyncio.sleep(0.05)
            executor.release_starts.set()
            await asyncio.gather(task_a, task_b)

        assert list(executor.started) == ["queued-once"]

        async with db() as session:
            row = await session.get(RunRow, "queued-once")
            assert row is not None
            assert row.state == RunState.running.value
            assert row.pid is not None

        executor.finish(row.pid)
    finally:
        await engine.dispose()


async def test_launch_with_queue_false_rejects_active_run(db, project: str) -> None:
    executor = QueueExecutor()
    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="first")
        with pytest.raises(FileExistsError):
            await svc.launch(project, kind=RunKind.flow, flow="second", queue=False)

    assert active.pid is not None
    executor.finish(active.pid)
    await wait_for_supervisor_tasks()


async def test_stop_queued_run_returns_cancelled_when_drain_fails(
    db, project: str, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    executor = QueueExecutor()

    async def fail_drain(workspace: str, bin_path: str) -> None:
        raise RuntimeError("drain failed")

    monkeypatch.setattr(runs_module, "ensure_workspace_ready", fail_drain)

    async with db() as session:
        session.add_all(
            [
                RunRow(
                    id="queued-1",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="first",
                    queued_at=datetime.now(tz=UTC),
                ),
                RunRow(
                    id="queued-2",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="second",
                    queued_at=datetime.now(tz=UTC) + timedelta(seconds=1),
                ),
            ]
        )
        await session.commit()

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        stopped = await svc.stop("queued-1")

    assert stopped.state == RunState.cancelled
    assert "Queue drain failed" in caplog.text
    assert "project_id=proj1" in caplog.text
    assert "run_id=queued-1" in caplog.text

    async with db() as session:
        row = await session.get(RunRow, "queued-2")
        assert row is not None
        assert row.state == RunState.queued.value


async def test_stop_queued_run_cancels_without_executor_calls(db, project: str) -> None:
    executor = QueueExecutor()
    async with db() as session:
        session.add(
            RunRow(
                id="queued-1",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.queued.value,
                executor="local",
                flow="issue_fix",
            )
        )
        await session.commit()

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        stopped = await svc.stop("queued-1")

    assert stopped.state == RunState.cancelled
    assert executor.status_calls == 0
    assert executor.stop_calls == 0

    async with db() as session:
        rows = await session.execute(select(RunRow).where(RunRow.state == RunState.queued.value))
        assert rows.scalars().all() == []
