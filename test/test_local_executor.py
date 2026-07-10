"""Integration tests for LocalExecutor and workspace initialization."""

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.executors.local import LocalExecutor
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunKind, RunSpec, RunState
from orquesta_api.services.runs import RunSupervisor, ensure_workspace_ready


class DelayedExecutor(ExecutorInterface):
    """Executor test double that keeps launch calls overlapped."""

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        await asyncio.sleep(0.05)
        return RunHandle(run_id=run_id)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        return None

    async def status(self, handle: RunHandle) -> RunState:
        return RunState.running

    async def wait(self, handle: RunHandle) -> int:
        return 0

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        return self._empty_logs()

    async def _empty_logs(self) -> AsyncIterator[str]:
        if False:
            yield ""

    async def inspect(self, handle: RunHandle) -> Container | None:
        return None


async def test_start_run_writes_invocation_and_succeeds(fake_bin: str, tmp_path: Path) -> None:
    """LocalExecutor.start spawns orq-lite with correct argv and cwd."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    executor = LocalExecutor(bin_path=fake_bin)
    spec = RunSpec(
        project_id="p",
        workspace_path=str(workspace),
        kind=RunKind.run,
    )
    handle = await executor.start(spec)
    assert handle.pid is not None
    assert handle.api_port is None  # headless; no per-run port

    # Wait for the fake process to exit
    process = executor._processes[handle.pid]
    await process.wait()

    # invocation.json is written relative to cwd (workspace)
    log_path = workspace / "invocation.json"
    assert log_path.exists(), "fake binary should write invocation.json inside workspace"
    invocation = json.loads(log_path.read_text().splitlines()[0])
    assert invocation["argv"] == ["run"]
    assert invocation["cwd"] == str(workspace)

    # Status transitions to succeeded after process exits with 0
    state = await executor.status(handle)
    assert state == RunState.succeeded


async def test_ensure_workspace_ready_calls_init_when_team_json_absent(
    fake_bin: str, tmp_path: Path
) -> None:
    """ensure_workspace_ready runs orq-lite init when team.json is missing."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    await ensure_workspace_ready(str(workspace), bin_path=fake_bin)

    log_path = workspace / "invocation.json"
    assert log_path.exists(), "init call should have written invocation.json"
    lines = log_path.read_text().splitlines()
    assert json.loads(lines[0])["argv"] == ["init"]


async def test_ensure_workspace_ready_skips_init_when_team_json_exists(
    fake_bin: str, tmp_path: Path
) -> None:
    """ensure_workspace_ready is a no-op when team.json already exists."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "team.json").write_text("{}")

    await ensure_workspace_ready(str(workspace), bin_path=fake_bin)

    log_path = workspace / "invocation.json"
    assert not log_path.exists(), "init should not be called when team.json is present"


async def test_init_then_run_invocations_in_order(fake_bin: str, tmp_path: Path) -> None:
    """When workspace has no team.json, init is recorded before the run invocation."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    log_path = workspace / "invocation.json"

    # Workspace prep: init is called first
    await ensure_workspace_ready(str(workspace), bin_path=fake_bin)

    # Then start the actual run
    executor = LocalExecutor(bin_path=fake_bin)
    spec = RunSpec(project_id="p", workspace_path=str(workspace), kind=RunKind.run)
    handle = await executor.start(spec)
    process = executor._processes[handle.pid]
    await process.wait()

    lines = log_path.read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["argv"] == ["init"]
    assert json.loads(lines[1])["argv"] == ["run"]


async def test_launch_rejects_second_run_for_same_project(
    session, fake_bin: str, tmp_path: Path
) -> None:
    """RunSupervisor.launch raises FileExistsError (→409) when a run is already active."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "team.json").write_text("{}")

    project = ProjectRow(
        id="proj1",
        name="Test Project",
        workspace_path=str(workspace),
    )
    session.add(project)

    active_run = RunRow(
        id="run1",
        project_id="proj1",
        kind="run",
        state=RunState.running.value,
        executor="local",
    )
    session.add(active_run)
    await session.flush()

    executor = LocalExecutor(bin_path=fake_bin)
    svc = RunSupervisor(session, executor=executor)
    with pytest.raises(FileExistsError, match="proj1"):
        await svc.launch("proj1", kind=RunKind.run)


async def test_concurrent_launches_admit_only_one_active_run(tmp_path: Path) -> None:
    """The database constraint makes one-active-run admission atomic."""
    db_path = tmp_path / "runs.sqlite"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(ProjectRow.metadata.create_all)

        maker = async_sessionmaker(engine, expire_on_commit=False)
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        (workspace / "team.json").write_text("{}")

        async with maker() as session:
            session.add(
                ProjectRow(
                    id="proj1",
                    name="Test Project",
                    workspace_path=str(workspace),
                )
            )
            await session.commit()

        executor = DelayedExecutor()

        async def launch_once() -> RunState | type[FileExistsError]:
            async with maker() as session:
                svc = RunSupervisor(session, executor=executor, session_maker=maker)
                try:
                    run = await svc.launch("proj1", kind=RunKind.run)
                except FileExistsError:
                    return FileExistsError
                return run.state

        results = await asyncio.gather(launch_once(), launch_once())

        assert results.count(RunState.running) == 1
        assert results.count(FileExistsError) == 1

        async with maker() as session:
            rows = await session.execute(select(RunRow).where(RunRow.project_id == "proj1"))
            assert len(rows.scalars().all()) == 1
    finally:
        await engine.dispose()
