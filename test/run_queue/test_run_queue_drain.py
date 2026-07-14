"""Tests for draining queued runs via supervise and reconcile."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from queue_fakes import QueueExecutor, wait_for_run_state, wait_for_supervisor_tasks

from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.meta.models import RunKind, RunState
from orquesta_api.services import runs as runs_module
from orquesta_api.services.runs import RunSupervisor


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

    row = await wait_for_run_state(db, queued.id, RunState.running)
    assert row.pid is not None
    assert executor.started[queued.id].flow == "second"
    assert executor.started[queued.id].inputs == {"ticket": "123"}

    executor.finish(row.pid)
    await wait_for_supervisor_tasks()


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

    row = await wait_for_run_state(db, queued.id, RunState.running)
    assert row.pid is not None
    assert executor.started[queued.id].flow == "second"
    assert executor.started[queued.id].inputs == {"ticket": "123"}

    executor.finish(row.pid)
    await wait_for_supervisor_tasks()


async def test_supervise_logs_drain_error_and_leaves_queue_for_later_retry(
    db, project: str, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    executor = QueueExecutor()
    calls = 0
    original_ensure = runs_module.ensure_workspace_ready

    async def fail_first_drain(workspace: str, bin_path: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            msg = "drain init failed"
            raise RuntimeError(msg)
        await original_ensure(workspace, bin_path)

    monkeypatch.setattr(runs_module, "ensure_workspace_ready", fail_first_drain)

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="first")
        queued = await svc.launch(project, kind=RunKind.flow, flow="second")

    assert active.pid is not None
    executor.finish(active.pid)
    await wait_for_supervisor_tasks()

    async with db() as session:
        row = await session.get(RunRow, queued.id)
        assert row is not None
        assert row.state == RunState.queued.value

    assert "Queue drain failed" in caplog.text
    assert "project_id=proj1" in caplog.text
    assert "run_id=" in caplog.text

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        await svc.reconcile()

    row = await wait_for_run_state(db, queued.id, RunState.running)
    assert row.pid is not None
    executor.finish(row.pid)
    await wait_for_supervisor_tasks()


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

    row = await wait_for_run_state(db, "aa-older", RunState.running)
    assert row.pid is not None
    assert executor.started["aa-older"].flow == "older"

    async with db() as session:
        newer = await session.get(RunRow, "zz-newer")
        assert newer is not None
        assert newer.state == RunState.queued.value

    executor.finish(row.pid)
    await wait_for_supervisor_tasks()


async def test_reconcile_logs_and_continues_when_one_project_drain_fails(
    db, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    executor = QueueExecutor()
    bad_workspace = tmp_path / "bad"
    good_workspace = tmp_path / "good"
    bad_workspace.mkdir()
    good_workspace.mkdir()
    (bad_workspace / "team.json").write_text("{}")
    (good_workspace / "team.json").write_text("{}")

    original_ensure = runs_module.ensure_workspace_ready

    async def fail_bad_workspace(workspace: str, bin_path: str) -> None:
        if workspace == str(bad_workspace):
            raise RuntimeError("bad workspace")
        await original_ensure(workspace, bin_path)

    monkeypatch.setattr(runs_module, "ensure_workspace_ready", fail_bad_workspace)

    async with db() as session:
        session.add_all(
            [
                ProjectRow(
                    id="bad",
                    name="Bad",
                    workspace_path=str(bad_workspace),
                    state="idle",
                ),
                ProjectRow(
                    id="good",
                    name="Good",
                    workspace_path=str(good_workspace),
                    state="idle",
                ),
                RunRow(
                    id="bad-queued",
                    project_id="bad",
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="issue_fix",
                ),
                RunRow(
                    id="good-queued",
                    project_id="good",
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="issue_fix",
                ),
            ]
        )
        await session.commit()

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        await svc.reconcile()

    assert "Queue drain failed" in caplog.text
    assert "project_id=bad" in caplog.text
    bad = await wait_for_run_state(db, "bad-queued", RunState.queued)
    good = await wait_for_run_state(db, "good-queued", RunState.running)
    assert bad.pid is None
    assert good.pid is not None

    executor.finish(good.pid)
    await wait_for_supervisor_tasks()


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

    row = await wait_for_run_state(db, "queued-1", RunState.running)
    assert row.pid is not None
    assert executor.started["queued-1"].flow == "issue_fix"
    assert executor.started["queued-1"].inputs == {"issue_number": "7"}

    executor.finish(row.pid)
    await wait_for_supervisor_tasks()


async def test_get_reconcile_starts_queued_run_after_external_finish(db, project: str) -> None:
    executor = QueueExecutor()
    finished_pid = 2001
    finished = asyncio.get_running_loop().create_future()
    finished.set_result(0)
    executor._waits[finished_pid] = finished
    async with db() as session:
        project_row = await session.get(ProjectRow, project)
        assert project_row is not None
        project_row.state = "running"
        session.add_all(
            [
                RunRow(
                    id="active-run",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.running.value,
                    executor="local",
                    flow="active",
                    pid=finished_pid,
                ),
                RunRow(
                    id="queued-run",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="queued",
                ),
            ]
        )
        await session.commit()

    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        reconciled = await svc.get("active-run")

    assert reconciled.state == RunState.succeeded
    row = await wait_for_run_state(db, "queued-run", RunState.running)
    assert row.pid is not None

    executor.finish(row.pid)
    await wait_for_supervisor_tasks()


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

    row = await wait_for_run_state(db, "queued-1", RunState.running)
    assert row.pid is not None
    assert executor.started["queued-1"].flow == "issue_fix"
    assert executor.started["queued-1"].inputs == {"issue_number": "7"}

    executor.finish(row.pid)
    await wait_for_supervisor_tasks()
