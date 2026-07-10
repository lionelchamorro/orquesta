"""Tests for per-project queued runs."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base, ProjectRow, RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunKind, RunSpec, RunState
from orquesta_api.services import runs as runs_module
from orquesta_api.services.runs import RunSupervisor
from orquesta_api.services.watchers import WatcherService


class QueueExecutor(ExecutorInterface):
    """Executor test double whose waits complete only when the test releases them."""

    def __init__(self) -> None:
        self.started: dict[str, RunSpec] = {}
        self._pid = 1000
        self._by_pid: dict[int, str] = {}
        self._waits: dict[int, asyncio.Future[int]] = {}
        self.stop_calls = 0
        self.status_calls = 0

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        self._pid += 1
        pid = self._pid
        self.started[run_id] = spec
        self._by_pid[pid] = run_id
        self._waits[pid] = asyncio.get_running_loop().create_future()
        return RunHandle(pid=pid, run_id=run_id)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        self.stop_calls += 1
        if handle.pid is not None and handle.pid in self._waits:
            self._waits[handle.pid].set_result(0)

    async def status(self, handle: RunHandle) -> RunState:
        self.status_calls += 1
        if handle.pid is None:
            return RunState.failed
        wait = self._waits.get(handle.pid)
        if wait is None:
            return RunState.failed
        if not wait.done():
            return RunState.running
        return RunState.succeeded if wait.result() == 0 else RunState.failed

    async def wait(self, handle: RunHandle) -> int:
        if handle.pid is None:
            return 1
        return await self._waits[handle.pid]

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        return self._empty_logs()

    async def _empty_logs(self) -> AsyncIterator[str]:
        if False:
            yield ""

    async def inspect(self, handle: RunHandle) -> Container | None:
        return None

    def finish(self, pid: int, exit_code: int = 0) -> None:
        self._waits[pid].set_result(exit_code)


@pytest.fixture
async def db(tmp_path: Path):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker: async_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest.fixture
async def project(db, tmp_path: Path) -> str:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "team.json").write_text("{}")
    async with db() as session:
        session.add(ProjectRow(id="proj1", name="Project", workspace_path=str(workspace)))
        await session.commit()
    return "proj1"


@pytest.fixture(autouse=True)
async def _drain_supervisor_tasks() -> None:
    yield
    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def _wait_for_supervisor_tasks() -> None:
    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _wait_for_run_state(db, run_id: str, state: RunState) -> RunRow:
    for _ in range(200):
        async with db() as session:
            row = await session.get(RunRow, run_id)
            if row is not None and row.state == state.value:
                return row
        await asyncio.sleep(0.01)
    raise AssertionError(f"run {run_id} did not reach {state.value}")


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
    await _wait_for_supervisor_tasks()


async def test_launch_with_queue_false_rejects_active_run(db, project: str) -> None:
    executor = QueueExecutor()
    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="first")
        with pytest.raises(FileExistsError):
            await svc.launch(project, kind=RunKind.flow, flow="second", queue=False)

    assert active.pid is not None
    executor.finish(active.pid)
    await _wait_for_supervisor_tasks()


async def test_supervise_starts_oldest_queued_run(db, project: str) -> None:
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

    assert active.pid is not None
    executor.finish(active.pid)

    row = await _wait_for_run_state(db, queued.id, RunState.running)
    assert row.pid is not None
    assert executor.started[queued.id].flow == "second"
    assert executor.started[queued.id].inputs == {"ticket": "123"}

    executor.finish(row.pid)
    await _wait_for_supervisor_tasks()


async def test_supervise_starts_oldest_queued_run_after_active_failure(db, project: str) -> None:
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

    assert active.pid is not None
    executor.finish(active.pid, exit_code=1)

    row = await _wait_for_run_state(db, queued.id, RunState.running)
    assert row.pid is not None
    assert executor.started[queued.id].flow == "second"
    assert executor.started[queued.id].inputs == {"ticket": "123"}

    executor.finish(row.pid)
    await _wait_for_supervisor_tasks()


async def test_supervise_starts_queued_runs_in_fifo_order(db, project: str) -> None:
    executor = QueueExecutor()
    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="active")
        now = datetime.now(tz=UTC)
        session.add_all(
            [
                RunRow(
                    id="zz-newer",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="newer",
                    created_at=now,
                    queued_at=now + timedelta(seconds=1),
                ),
                RunRow(
                    id="aa-older",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="older",
                    created_at=now + timedelta(seconds=1),
                    queued_at=now,
                ),
            ]
        )
        await session.commit()

    assert active.pid is not None
    executor.finish(active.pid)

    row = await _wait_for_run_state(db, "aa-older", RunState.running)
    assert row.pid is not None
    assert executor.started["aa-older"].flow == "older"

    async with db() as session:
        newer = await session.get(RunRow, "zz-newer")
        assert newer is not None
        assert newer.state == RunState.queued.value

    executor.finish(row.pid)
    await _wait_for_supervisor_tasks()


async def test_reconcile_leaves_queued_rows_and_starts_when_idle(db, project: str) -> None:
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
                inputs={"issue_number": "7"},
            )
        )
        await session.commit()

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        await svc.reconcile()

    row = await _wait_for_run_state(db, "queued-1", RunState.running)
    assert row.pid is not None
    assert executor.started["queued-1"].flow == "issue_fix"
    assert executor.started["queued-1"].inputs == {"issue_number": "7"}

    executor.finish(row.pid)
    await _wait_for_supervisor_tasks()


async def test_reconcile_starts_queued_rows_when_project_needs_human(db, project: str) -> None:
    executor = QueueExecutor()
    async with db() as session:
        row = await session.get(ProjectRow, project)
        assert row is not None
        row.state = "needs_human"
        session.add(
            RunRow(
                id="queued-1",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.queued.value,
                executor="local",
                flow="issue_fix",
                inputs={"issue_number": "7"},
            )
        )
        await session.commit()

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        await svc.reconcile()

    row = await _wait_for_run_state(db, "queued-1", RunState.running)
    assert row.pid is not None
    assert executor.started["queued-1"].flow == "issue_fix"
    assert executor.started["queued-1"].inputs == {"issue_number": "7"}

    executor.finish(row.pid)
    await _wait_for_supervisor_tasks()


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


async def test_webhook_queues_busy_project_and_dedupes(
    db, project: str, caplog: pytest.LogCaptureFixture
) -> None:
    executor = QueueExecutor()
    async with db() as session:
        row = await session.get(ProjectRow, project)
        assert row is not None
        row.repo_url = "https://github.com/acme/atlas"
        row.watch_prs = True
        await session.commit()

        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="first")

        watchers = WatcherService(session)
        payload = {
            "action": "opened",
            "number": 42,
            "pull_request": {"number": 42},
            "repository": {"clone_url": "https://github.com/acme/atlas.git"},
        }
        queued = await watchers.handle_pull_request(payload)
        duplicate = await watchers.handle_pull_request(payload)

        assert queued is not None
        assert queued.state == RunState.queued
        assert duplicate is None

        result = await session.execute(
            select(RunRow).where(
                RunRow.project_id == project,
                RunRow.state == RunState.queued.value,
            )
        )
        rows = result.scalars().all()
        assert len(rows) == 1
        assert rows[0].flow == "pr_review"
        assert rows[0].inputs == {"pr_number": "42", "publish": "true"}

    assert "identical queued run exists" in caplog.text
    assert active.pid is not None
    executor.finish(active.pid)
    await _wait_for_supervisor_tasks()


async def test_webhook_dedupe_matches_inputs_independent_of_json_key_order(
    db, project: str, caplog: pytest.LogCaptureFixture
) -> None:
    executor = QueueExecutor()
    async with db() as session:
        row = await session.get(ProjectRow, project)
        assert row is not None
        row.repo_url = "https://github.com/acme/atlas"
        row.watch_prs = True
        await session.commit()

        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="first")
        session.add(
            RunRow(
                id="queued-pr",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.queued.value,
                executor="local",
                flow="pr_review",
                inputs={"publish": "true", "pr_number": "42"},
                created_at=datetime.now(tz=UTC),
            )
        )
        await session.commit()

        watchers = WatcherService(session)
        duplicate = await watchers.handle_pull_request(
            {
                "action": "opened",
                "number": 42,
                "pull_request": {"number": 42},
                "repository": {"clone_url": "https://github.com/acme/atlas.git"},
            }
        )

        assert duplicate is None
        result = await session.execute(
            select(RunRow).where(
                RunRow.project_id == project,
                RunRow.state == RunState.queued.value,
                RunRow.flow == "pr_review",
            )
        )
        assert len(result.scalars().all()) == 1

    assert "identical queued run exists" in caplog.text
    assert active.pid is not None
    executor.finish(active.pid)
    await _wait_for_supervisor_tasks()
