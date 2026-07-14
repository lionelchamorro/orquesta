"""Tests for webhook-triggered queueing and duplicate-run suppression."""

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest
from queue_fakes import QueueExecutor, wait_for_supervisor_tasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base, ProjectRow, RunRow
from orquesta_api.meta.models import RunKind, RunState
from orquesta_api.services.run_queue import canonical_inputs_hash
from orquesta_api.services.runs import RunSupervisor
from orquesta_api.services.watchers import WatcherService


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

    assert "identical active or queued run exists" in caplog.text
    assert active.pid is not None
    executor.finish(active.pid)
    await wait_for_supervisor_tasks()


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
                inputs_hash=canonical_inputs_hash({"publish": "true", "pr_number": "42"}),
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

    assert "identical active or queued run exists" in caplog.text
    assert active.pid is not None
    executor.finish(active.pid)
    await wait_for_supervisor_tasks()


async def test_webhook_dedupes_matching_process_active_run(
    db, project: str, caplog: pytest.LogCaptureFixture
) -> None:
    now = datetime.now(tz=UTC)
    async with db() as session:
        row = await session.get(ProjectRow, project)
        assert row is not None
        row.repo_url = "https://github.com/acme/atlas"
        row.watch_prs = True
        row.state = "running"
        session.add(
            RunRow(
                id="starting-pr",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.starting.value,
                executor="local",
                flow="pr_review",
                inputs={"pr_number": "42", "publish": "true"},
                inputs_hash=canonical_inputs_hash({"pr_number": "42", "publish": "true"}),
                created_at=now,
            )
        )
        await session.commit()

        duplicate = await WatcherService(session).handle_pull_request(
            {
                "action": "opened",
                "number": 42,
                "pull_request": {"number": 42},
                "repository": {"clone_url": "https://github.com/acme/atlas.git"},
            }
        )

        assert duplicate is None
        result = await session.execute(
            select(RunRow).where(RunRow.project_id == project, RunRow.flow == "pr_review")
        )
        assert len(result.scalars().all()) == 1

    assert "identical active or queued run exists" in caplog.text


async def test_concurrent_identical_webhooks_enqueue_one_row(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'webhook-race.sqlite'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db: async_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    project = "proj1"
    now = datetime.now(tz=UTC)
    try:
        async with db() as session:
            session.add_all(
                [
                    ProjectRow(
                        id=project,
                        name="Project",
                        repo_url="https://github.com/acme/atlas",
                        workspace_path=str(tmp_path / "workspace"),
                        watch_prs=True,
                        state="running",
                    ),
                    RunRow(
                        id="active-run",
                        project_id=project,
                        kind=RunKind.flow.value,
                        state=RunState.running.value,
                        executor="local",
                        flow="other",
                        created_at=now,
                    ),
                ]
            )
            await session.commit()

        payload = {
            "action": "opened",
            "number": 42,
            "pull_request": {"number": 42},
            "repository": {"clone_url": "https://github.com/acme/atlas.git"},
        }
        async with db() as session_a, db() as session_b:
            first, second = await asyncio.gather(
                WatcherService(session_a).handle_pull_request(payload),
                WatcherService(session_b).handle_pull_request(payload),
            )

        assert sum(run is not None for run in (first, second)) == 1

        async with db() as session:
            result = await session.execute(
                select(RunRow).where(
                    RunRow.project_id == project,
                    RunRow.state == RunState.queued.value,
                    RunRow.flow == "pr_review",
                )
            )
            rows = result.scalars().all()
            assert len(rows) == 1
            assert rows[0].inputs == {"pr_number": "42", "publish": "true"}
    finally:
        await engine.dispose()

    assert "deduped by queued run uniqueness" in caplog.text


async def test_webhook_dedupe_preserves_different_inputs(db, project: str) -> None:
    now = datetime.now(tz=UTC)
    async with db() as session:
        row = await session.get(ProjectRow, project)
        assert row is not None
        row.repo_url = "https://github.com/acme/atlas"
        row.watch_prs = True
        row.state = "running"
        session.add_all(
            [
                RunRow(
                    id="active-run",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.running.value,
                    executor="local",
                    flow="other",
                    created_at=now,
                ),
                RunRow(
                    id="queued-pr-42",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.queued.value,
                    executor="local",
                    flow="pr_review",
                    inputs={"pr_number": "42", "publish": "true"},
                    inputs_hash=canonical_inputs_hash({"pr_number": "42", "publish": "true"}),
                    created_at=now,
                    queued_at=now,
                ),
            ]
        )
        await session.commit()

        run = await WatcherService(session).handle_pull_request(
            {
                "action": "opened",
                "number": 43,
                "pull_request": {"number": 43},
                "repository": {"clone_url": "https://github.com/acme/atlas.git"},
            }
        )

        assert run is not None
        assert run.state == RunState.queued
        result = await session.execute(
            select(RunRow).where(
                RunRow.project_id == project,
                RunRow.state == RunState.queued.value,
                RunRow.flow == "pr_review",
            )
        )
        rows = result.scalars().all()
        assert len(rows) == 2
        assert {row.inputs["pr_number"] for row in rows if row.inputs is not None} == {"42", "43"}
