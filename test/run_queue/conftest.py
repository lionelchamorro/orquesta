"""Shared fixtures for the per-project run-queue tests."""

import asyncio
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from orquesta_api.db.tables import Base, ProjectRow
from orquesta_api.services import runs as runs_module


@pytest.fixture
async def db(tmp_path: Path):
    # File-based SQLite with NullPool so every session gets its own connection.
    # With the default StaticPool all sessions share a single connection;
    # SQLAlchemy's ROLLBACK-on-checkin races with concurrent transactions
    # (e.g. _supervise vs wait_for_run_state polling) and silently undoes
    # committed writes.  NullPool gives each session an independent connection;
    # the named file persists throughout the test so tables are always visible.
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", poolclass=NullPool)
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
