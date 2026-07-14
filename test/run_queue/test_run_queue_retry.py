"""Tests for retrying finished runs with their persisted launch parameters."""

from datetime import UTC, datetime

import pytest
from queue_fakes import QueueExecutor, wait_for_supervisor_tasks

from orquesta_api.db.tables import RunRow
from orquesta_api.meta.models import RunKind, RunState
from orquesta_api.routers.runs import RunRetry, retry_run
from orquesta_api.services.runs import RunSupervisor


async def test_retry_finished_run_launches_with_persisted_parameters(db, project: str) -> None:
    executor = QueueExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        original = RunRow(
            id="failed-run",
            project_id=project,
            kind=RunKind.flow.value,
            state=RunState.failed.value,
            executor="local",
            created_at=now,
            finished_at=now,
            flow="pr_review",
            inputs={"ticket": "123", "mode": "strict"},
            plan_path="plans/fix.md",
            args=["--verbose"],
            error="failed",
        )
        session.add(original)
        await session.commit()

        svc = RunSupervisor(session, executor=executor, session_maker=db)
        retried = await svc.retry("failed-run")

    assert retried.state == RunState.running
    assert retried.id != "failed-run"
    spec = executor.started[retried.id]
    assert spec.kind == RunKind.flow
    assert spec.flow == "pr_review"
    assert spec.inputs == {"ticket": "123", "mode": "strict"}
    assert spec.plan_path == "plans/fix.md"
    assert spec.args == ["--verbose"]

    assert retried.pid is not None
    executor.finish(retried.pid)
    await wait_for_supervisor_tasks()


async def test_retry_finished_run_queues_with_persisted_parameters_when_project_busy(
    db, project: str
) -> None:
    executor = QueueExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="active")
        original = RunRow(
            id="failed-run",
            project_id=project,
            kind=RunKind.flow.value,
            state=RunState.failed.value,
            executor="local",
            created_at=now,
            finished_at=now,
            flow="pr_review",
            inputs={"ticket": "123", "mode": "strict"},
            plan_path="plans/fix.md",
            args=["--verbose"],
            error="failed",
        )
        session.add(original)
        await session.commit()

        retried = await svc.retry("failed-run")

    assert retried.state == RunState.queued
    assert retried.id != "failed-run"
    assert len(executor.started) == 1

    async with db() as session:
        row = await session.get(RunRow, retried.id)
        assert row is not None
        assert row.flow == "pr_review"
        assert row.inputs == {"ticket": "123", "mode": "strict"}
        assert row.plan_path == "plans/fix.md"
        assert row.args == ["--verbose"]
        assert row.queued_at is not None

    assert active.pid is not None
    executor.finish(active.pid)
    await wait_for_supervisor_tasks()


async def test_retry_endpoint_delegates_to_supervisor(db, project: str) -> None:
    executor = QueueExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add(
            RunRow(
                id="failed-run",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.failed.value,
                executor="local",
                created_at=now,
                finished_at=now,
                flow="pr_review",
                inputs={"ticket": "123"},
            )
        )
        await session.commit()

        retried = await retry_run(
            "failed-run",
            session,
            executor,
            RunRetry(feedback="please keep the auth fix smaller"),
        )

    assert retried.state == RunState.running
    assert executor.started[retried.id].flow == "pr_review"
    assert executor.started[retried.id].inputs == {
        "ticket": "123",
        "feedback": "please keep the auth fix smaller",
    }

    assert retried.pid is not None
    executor.finish(retried.pid)
    await wait_for_supervisor_tasks()


async def test_retry_rejects_flow_without_persisted_flow_name(db, project: str) -> None:
    executor = QueueExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add(
            RunRow(
                id="failed-run",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.failed.value,
                executor="local",
                created_at=now,
                finished_at=now,
                inputs={"ticket": "123"},
            )
        )
        await session.commit()

        svc = RunSupervisor(session, executor=executor, session_maker=db)
        with pytest.raises(ValueError, match="persisted flow"):
            await svc.retry("failed-run")
