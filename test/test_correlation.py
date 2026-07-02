"""Task 9: run_start events on the bus correlate RunRow.orq_run_id."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base, ProjectRow, RunRow
from orquesta_api.meta.models import RunEvent, RunKind, RunState
from orquesta_api.services.correlation import RunCorrelator
from orquesta_api.services.events import EventBus


@pytest.fixture
async def db(tmp_path: Path):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


async def _seed_active_run(maker, started_at: datetime, workspace: str = "unused-path") -> str:
    async with maker() as session:
        session.add(ProjectRow(id="atlas", name="Atlas", workspace_path=workspace))
        session.add(
            RunRow(
                id="orquesta-run-1",
                project_id="atlas",
                kind=RunKind.flow.value,
                state=RunState.running.value,
                executor="local",
                started_at=started_at.replace(tzinfo=None),
            )
        )
        await session.commit()
    return "orquesta-run-1"


def _run_start(ts: datetime, orq_run_id: str = "orq-abc") -> RunEvent:
    return RunEvent(
        ts=ts.isoformat(),
        event="run_start",
        project="atlas",
        run_id=orq_run_id,
    )


async def _get_orq_run_id(maker, run_id: str) -> str | None:
    async with maker() as session:
        row = await session.get(RunRow, run_id)
        return row.orq_run_id if row else None


async def test_run_start_sets_orq_run_id_on_active_run(db) -> None:
    now = datetime.now(tz=UTC)
    run_id = await _seed_active_run(db, started_at=now - timedelta(seconds=2))

    bus = EventBus()
    correlator = RunCorrelator(bus, db)
    correlator.start()
    await correlator.wait_ready()
    try:
        await bus.publish(_run_start(ts=now))
        await asyncio.sleep(0.05)
        assert await _get_orq_run_id(db, run_id) == "orq-abc"
    finally:
        await correlator.shutdown()


async def test_replayed_stale_run_start_is_rejected(db) -> None:
    """A replayed run_start older than the RunRow's launch must not attach.

    The SSE consumer replays the last ~100 log lines on every reconnect, so
    a previous run's run_start can arrive while a new RunRow is active.
    """
    now = datetime.now(tz=UTC)
    run_id = await _seed_active_run(db, started_at=now)

    bus = EventBus()
    correlator = RunCorrelator(bus, db)
    correlator.start()
    await correlator.wait_ready()
    try:
        stale = _run_start(ts=now - timedelta(minutes=10), orq_run_id="orq-OLD")
        await bus.publish(stale)
        await asyncio.sleep(0.05)
        assert await _get_orq_run_id(db, run_id) is None

        fresh = _run_start(ts=now + timedelta(seconds=1), orq_run_id="orq-NEW")
        await bus.publish(fresh)
        await asyncio.sleep(0.05)
        assert await _get_orq_run_id(db, run_id) == "orq-NEW"
    finally:
        await correlator.shutdown()


async def test_events_without_project_or_run_id_are_ignored(db) -> None:
    now = datetime.now(tz=UTC)
    run_id = await _seed_active_run(db, started_at=now)

    bus = EventBus()
    correlator = RunCorrelator(bus, db)
    correlator.start()
    await correlator.wait_ready()
    try:
        await bus.publish(RunEvent(ts=now.isoformat(), event="run_start", project="atlas"))
        await bus.publish(RunEvent(ts=now.isoformat(), event="agent_run", project="atlas"))
        await asyncio.sleep(0.05)
        assert await _get_orq_run_id(db, run_id) is None
    finally:
        await correlator.shutdown()
