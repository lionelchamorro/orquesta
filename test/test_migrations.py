"""Task 17: startup schema-version check replaces the blind create_all.

Covers:
  - an empty database is bootstrapped and stamped at head (dev/demo path).
  - a database already at head passes silently.
  - a database with tables but no/stale alembic_version fails fast.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from orquesta_api.db.migrations import _head_revision, ensure_schema_current
from orquesta_api.db.tables import ProjectRow


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
