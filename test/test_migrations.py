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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from orquesta_api.db.migrations import _head_revision, ensure_schema_current
from orquesta_api.db.tables import Base, ProjectRow
from orquesta_api.services.run_queue import canonical_inputs_hash


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
    migration = _load_migration_module("1f6d0dfba0c1_add_active_run_unique_index.py")
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


def test_run_queue_launch_params_migration_upgrade_and_downgrade(tmp_path) -> None:
    db_path = tmp_path / "queue-migration.sqlite"
    engine = create_engine(f"sqlite:///{db_path}")
    migration = _load_migration_module("7c2ef0ef6fb8_add_run_queue_launch_params.py")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            operations = Operations(MigrationContext.configure(conn))
            migration.op = operations

            conn.execute(text("DROP INDEX IF EXISTS uq_runs_one_active_per_project"))
            conn.execute(text("DROP INDEX IF EXISTS uq_runs_queued_flow_inputs"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX uq_runs_one_active_per_project ON runs (project_id) "
                    "WHERE state IN ('queued', 'starting', 'running', 'stopping')"
                )
            )
            for column in ("created_at", "queued_at", "flow", "inputs", "plan_path", "args"):
                conn.execute(text(f"ALTER TABLE runs DROP COLUMN {column}"))

            migration.upgrade()
            columns = {
                row["name"] for row in conn.execute(text("PRAGMA table_info('runs')")).mappings()
            }
            assert {"created_at", "queued_at", "flow", "inputs", "plan_path", "args"}.issubset(
                columns
            )
            index_sql = conn.execute(
                text(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type = 'index' AND name = 'uq_runs_one_active_per_project'"
                )
            ).scalar_one()
            assert "WHERE state IN ('starting', 'running', 'stopping')" in index_sql

            migration.downgrade()
            columns = {
                row["name"] for row in conn.execute(text("PRAGMA table_info('runs')")).mappings()
            }
            assert not {"created_at", "queued_at", "flow", "inputs", "plan_path", "args"} & columns
            old_index_sql = conn.execute(
                text(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type = 'index' AND name = 'uq_runs_one_active_per_project'"
                )
            ).scalar_one()
            assert "WHERE state IN ('queued', 'starting', 'running', 'stopping')" in old_index_sql
    finally:
        engine.dispose()


def test_run_queue_launch_params_migration_skips_existing_columns(tmp_path) -> None:
    db_path = tmp_path / "queue-migration-existing-columns.sqlite"
    engine = create_engine(f"sqlite:///{db_path}")
    migration = _load_migration_module("7c2ef0ef6fb8_add_run_queue_launch_params.py")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            operations = Operations(MigrationContext.configure(conn))
            migration.op = operations

            conn.execute(text("DROP INDEX IF EXISTS uq_runs_one_active_per_project"))
            conn.execute(text("DROP INDEX IF EXISTS uq_runs_queued_flow_inputs"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX uq_runs_one_active_per_project ON runs (project_id) "
                    "WHERE state IN ('queued', 'starting', 'running', 'stopping')"
                )
            )
            for column in ("queued_at", "flow", "inputs", "plan_path", "args"):
                conn.execute(text(f"ALTER TABLE runs DROP COLUMN {column}"))

            migration.upgrade()

            columns = {
                row["name"] for row in conn.execute(text("PRAGMA table_info('runs')")).mappings()
            }
            assert {"created_at", "queued_at", "flow", "inputs", "plan_path", "args"}.issubset(
                columns
            )
    finally:
        engine.dispose()


def test_inputs_hash_migration_backfills_and_enforces_queued_uniqueness(tmp_path) -> None:
    db_path = tmp_path / "inputs-hash-migration.sqlite"
    engine = create_engine(f"sqlite:///{db_path}")
    migration = _load_migration_module("8b6207a5a1d4_add_run_inputs_hash.py")
    expected = canonical_inputs_hash({"b": "2", "a": "1"})
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            operations = Operations(MigrationContext.configure(conn))
            migration.op = operations

            conn.execute(text("DROP INDEX IF EXISTS uq_runs_queued_flow_inputs"))
            conn.execute(text("ALTER TABLE runs DROP COLUMN inputs_hash"))
            conn.execute(
                text(
                    "INSERT INTO projects "
                    "(id, name, state, cost_usd, base_branch, watch_prs, watch_issues) "
                    "VALUES ('proj1', 'Project', 'idle', 0, 'main', 0, 0)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO runs "
                    "(id, project_id, kind, state, executor, flow, inputs) "
                    "VALUES "
                    "('queued-1', 'proj1', 'flow', 'queued', 'local', 'pr_review', :inputs)"
                ),
                {"inputs": '{"b":"2","a":"1"}'},
            )

            migration.upgrade()

            columns = {
                row["name"] for row in conn.execute(text("PRAGMA table_info('runs')")).mappings()
            }
            assert "inputs_hash" in columns
            assert (
                conn.execute(
                    text("SELECT inputs_hash FROM runs WHERE id = 'queued-1'")
                ).scalar_one()
                == expected
            )
            index_sql = conn.execute(
                text(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type = 'index' AND name = 'uq_runs_queued_flow_inputs'"
                )
            ).scalar_one()
            assert "WHERE state = 'queued'" in index_sql

            try:
                conn.execute(
                    text(
                        "INSERT INTO runs "
                        "(id, project_id, kind, state, executor, flow, inputs, inputs_hash) "
                        "VALUES "
                        "('queued-dup', 'proj1', 'flow', 'queued', 'local', "
                        "'pr_review', :inputs, :inputs_hash)"
                    ),
                    {"inputs": '{"a":"1","b":"2"}', "inputs_hash": expected},
                )
            except IntegrityError:
                pass
            else:
                raise AssertionError("expected queued duplicate inputs to violate unique index")

            migration.downgrade()
            columns = {
                row["name"] for row in conn.execute(text("PRAGMA table_info('runs')")).mappings()
            }
            assert "inputs_hash" not in columns
            indexes = conn.execute(text("PRAGMA index_list('runs')")).mappings().all()
            assert not any(row["name"] == "uq_runs_queued_flow_inputs" for row in indexes)
    finally:
        engine.dispose()


def test_canonical_inputs_hash_is_key_order_insensitive() -> None:
    assert canonical_inputs_hash({"b": "2", "a": "1"}) == canonical_inputs_hash(
        {"a": "1", "b": "2"}
    )
