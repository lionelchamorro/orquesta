"""Shared pytest fixtures for orquesta_api tests."""

import stat
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base

FAKE = Path(__file__).parent / "fake_orq_lite.py"


@pytest.fixture
async def session():
    """In-memory SQLite session with all tables created."""
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.fixture
def fake_bin(tmp_path: Path) -> str:
    """Return path to a temp executable that records argv/cwd and exits."""
    dst = tmp_path / "orq-lite"
    dst.write_text(f"#!/usr/bin/env python3\n{FAKE.read_text()}")
    dst.chmod(dst.stat().st_mode | stat.S_IEXEC)
    return str(dst)
