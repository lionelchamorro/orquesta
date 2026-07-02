"""Tests for run lifecycle: supervision, finalization, and startup reconciliation.

Steps covered:
  Step 1 — Happy path: launch → _supervise writes succeeded, project.state=idle.
  Step 2 — Failure path: exit 3 → failed, project.state=needs_human.
  Step 3 — Startup reconciliation: orphaned running row → failed + error message.
"""

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base, ProjectRow, RunRow
from orquesta_api.executors.local import LocalExecutor
from orquesta_api.meta.models import RunKind, RunState
from orquesta_api.services import runs as runs_module
from orquesta_api.services.runs import RunSupervisor

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def db(tmp_path: Path):
    """In-memory SQLite engine + session maker shared across sessions in one test."""
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker: async_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest.fixture
async def workspace(tmp_path: Path) -> Path:
    """Return a workspace directory that already has team.json (skips init)."""
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "team.json").write_text("{}")
    return ws


@pytest.fixture
async def project(db, workspace: Path) -> str:
    """Seed a ProjectRow in the DB and return its id."""
    async with db() as session:
        row = ProjectRow(
            id="proj1",
            name="Test Project",
            workspace_path=str(workspace),
        )
        session.add(row)
        await session.commit()
    return "proj1"


@pytest.fixture(autouse=True)
async def _drain_supervisor_tasks():
    """Ensure no supervisor tasks outlive the test."""
    yield
    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _wait_for_supervisor_tasks() -> None:
    """Await all current supervisor tasks so _supervise has committed its writes."""
    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


# ---------------------------------------------------------------------------
# Step 1: Happy path — exit 0 → succeeded, project.state = idle
# ---------------------------------------------------------------------------


async def test_happy_path_succeeds(db, project: str, fake_bin: str, tmp_path: Path) -> None:
    """_supervise writes succeeded + project idle after process exits with code 0."""
    log_dir = tmp_path / "run-logs"
    executor = LocalExecutor(bin_path=fake_bin, log_dir=log_dir)

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        run = await svc.launch(project, kind=RunKind.run)

    assert run.state == RunState.running
    assert run.pid is not None

    # Wait for _supervise background task to write the terminal state.
    await _wait_for_supervisor_tasks()

    # Verify final state in a fresh session.
    async with db() as session:
        row = await session.get(RunRow, run.id)
        assert row is not None
        assert row.state == RunState.succeeded.value, f"expected succeeded, got {row.state}"
        assert row.exit_code == 0
        assert row.finished_at is not None

        proj = await session.get(ProjectRow, project)
        assert proj is not None
        assert proj.state == "idle"
        assert proj.last_run is not None


# ---------------------------------------------------------------------------
# Step 2: Failure path — exit 3 → failed, project.state = needs_human
# ---------------------------------------------------------------------------


async def test_failure_path_marks_project_needs_human(
    monkeypatch, db, project: str, fake_bin: str, tmp_path: Path
) -> None:
    """_supervise writes failed + project needs_human after process exits with code 3."""
    monkeypatch.setenv("FAKE_EXIT_CODE", "3")

    log_dir = tmp_path / "run-logs"
    executor = LocalExecutor(bin_path=fake_bin, log_dir=log_dir)

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        run = await svc.launch(project, kind=RunKind.run)

    await _wait_for_supervisor_tasks()

    async with db() as session:
        row = await session.get(RunRow, run.id)
        assert row is not None
        assert row.state == RunState.failed.value, f"expected failed, got {row.state}"
        assert row.exit_code == 3
        assert row.finished_at is not None

        proj = await session.get(ProjectRow, project)
        assert proj is not None
        assert proj.state == "needs_human"
        assert proj.last_run is not None


# ---------------------------------------------------------------------------
# Step 3: Startup reconciliation — orphaned running row → failed
# ---------------------------------------------------------------------------


async def test_reconcile_orphans_active_runs(db, project: str) -> None:
    """reconcile() marks a running RunRow as failed with the orphan error message."""
    # Seed a running run directly (bypasses launch so no real process exists).
    orphan_run_id = "orphan-run-1"
    async with db() as session:
        row = RunRow(
            id=orphan_run_id,
            project_id=project,
            kind=RunKind.run.value,
            state=RunState.running.value,
            executor="local",
            pid=99999,  # non-existent pid
            started_at=datetime.now(tz=UTC),
        )
        session.add(row)
        await session.commit()

    # Fresh executor has empty _processes — every active run is orphaned.
    executor = LocalExecutor()
    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        await svc.reconcile()

    # Verify the orphaned run is now failed.
    async with db() as session:
        row = await session.get(RunRow, orphan_run_id)
        assert row is not None
        assert row.state == RunState.failed.value, f"expected failed, got {row.state}"
        assert row.error == "orphaned by control-plane restart"
        assert row.finished_at is not None

        proj = await session.get(ProjectRow, project)
        assert proj is not None
        assert proj.state == "needs_human"


# ---------------------------------------------------------------------------
# Extra: log disk mirroring
# ---------------------------------------------------------------------------


async def test_log_mirroring_writes_disk_file(
    db, project: str, fake_bin: str, tmp_path: Path
) -> None:
    """LocalExecutor mirrors captured stdout to run-logs/<run_id>.log on disk."""
    log_dir = tmp_path / "run-logs"
    executor = LocalExecutor(bin_path=fake_bin, log_dir=log_dir)

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        run = await svc.launch(project, kind=RunKind.run)

    await _wait_for_supervisor_tasks()

    log_file = log_dir / f"{run.id}.log"
    assert log_file.exists(), f"expected log file at {log_file}"
    content = log_file.read_text()
    # fake_orq_lite.py prints "fake orq-lite done"
    assert "fake orq-lite done" in content


# ---------------------------------------------------------------------------
# Extra: stop() uses real exit code, not hardcoded 1
# ---------------------------------------------------------------------------


async def test_stop_uses_real_exit_code(
    db, project: str, fake_bin: str, tmp_path: Path, monkeypatch
) -> None:
    """stop() on an already-finished run returns the real exit code, not 1."""
    monkeypatch.setenv("FAKE_EXIT_CODE", "0")
    log_dir = tmp_path / "run-logs"
    executor = LocalExecutor(bin_path=fake_bin, log_dir=log_dir)

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        run = await svc.launch(project, kind=RunKind.run)

    # Wait for process to finish and _supervise to write terminal state.
    await _wait_for_supervisor_tasks()

    # Calling stop() on an already-finished run should return the current state.
    async with db() as session:
        svc2 = RunSupervisor(session, executor=executor, session_maker=db)
        stopped = await svc2.stop(run.id)

    # Already succeeded — stop() must not clobber with cancelled/exit_code=1.
    assert stopped.state == RunState.succeeded
    assert stopped.exit_code == 0
