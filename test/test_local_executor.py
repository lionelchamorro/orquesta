"""Integration tests for LocalExecutor and workspace initialization."""

import json
from pathlib import Path

import pytest

from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.executors.local import LocalExecutor
from orquesta_api.meta.models import RunKind, RunSpec, RunState
from orquesta_api.services.runs import RunSupervisor, ensure_workspace_ready


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
