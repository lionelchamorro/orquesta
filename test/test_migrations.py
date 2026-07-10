"""Task 17: startup schema-version check replaces the blind create_all.

Covers:
  - an empty database is bootstrapped and stamped at head (dev/demo path).
  - a database already at head passes silently.
  - a database with tables but no/stale alembic_version fails fast.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine

from orquesta_api.db.migrations import _head_revision, ensure_schema_current
from orquesta_api.db.tables import Base, ProjectRow


def _load_migration_module(filename: str) -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load migration {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_empty_database_is_bootstrapped_and_stamped() -> None:
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        await ensure_schema_current(engine)

        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT version_num FROM alembic_version"))
            assert result.scalar() == _head_revision()

            # The bootstrapped schema must actually be usable.
            await conn.execute(text("SELECT * FROM projects"))
    finally:
        await engine.dispose()


async def test_database_already_at_head_passes_silently() -> None:
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        await ensure_schema_current(engine)  # bootstraps + stamps
        await ensure_schema_current(engine)  # second call must not raise
    finally:
        await engine.dispose()


async def test_populated_database_without_version_table_raises() -> None:
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(ProjectRow.metadata.create_all)  # tables, but no alembic_version

        try:
            await ensure_schema_current(engine)
        except RuntimeError as exc:
            assert "Run `alembic upgrade head`" in str(exc)
        else:
            raise AssertionError("expected RuntimeError for an unstamped populated database")
    finally:
        await engine.dispose()


async def test_stale_version_raises() -> None:
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        await ensure_schema_current(engine)  # bootstrap at real head

        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE alembic_version SET version_num = 'not-a-real-revision'")
            )

        try:
            await ensure_schema_current(engine)
        except RuntimeError as exc:
            assert "not-a-real-revision" in str(exc)
        else:
            raise AssertionError("expected RuntimeError for a stale revision")
    finally:
        await engine.dispose()


def test_active_run_unique_index_migration_upgrade_and_downgrade(tmp_path) -> None:
    db_path = tmp_path / "migration.sqlite"
    engine = create_engine(f"sqlite:///{db_path}")
    migration = _load_migration_module(
        "1f6d0dfba0c1_add_active_run_unique_index.py"
    )
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            operations = Operations(MigrationContext.configure(conn))
            migration.op = operations

            conn.execute(text("DROP INDEX IF EXISTS uq_runs_one_active_per_project"))
            migration.upgrade()
            indexes = conn.execute(text("PRAGMA index_list('runs')")).mappings().all()
            assert any(
                row["name"] == "uq_runs_one_active_per_project" and row["unique"] == 1
                for row in indexes
            )
            index_sql = conn.execute(
                text(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type = 'index' AND name = 'uq_runs_one_active_per_project'"
                )
            ).scalar_one()
            assert "WHERE state IN ('queued', 'starting', 'running', 'stopping')" in index_sql

            migration.downgrade()
            indexes = conn.execute(text("PRAGMA index_list('runs')")).mappings().all()
            assert not any(row["name"] == "uq_runs_one_active_per_project" for row in indexes)
    finally:
        engine.dispose()
