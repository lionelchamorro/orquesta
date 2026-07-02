"""Startup schema-version check: replaces a blind create_all with a real gate.

- A genuinely empty database (no tables at all) is bootstrapped via
  create_all and stamped at the Alembic head — this keeps `uv run uvicorn
  ...` friction-free for local dev/demo without requiring `alembic upgrade
  head` as a manual first step.
- A database that already has tables but is missing or behind the head
  revision raises RuntimeError instead of silently migrating data in place;
  the operator must run `alembic upgrade head` explicitly before the API
  will serve requests.
"""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from orquesta_api.db.tables import Base
from orquesta_api.logger import get_logger

logger = get_logger(__name__)

_ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
_VERSION_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
)
"""


def _head_revision() -> str | None:
    config = Config(str(_ALEMBIC_INI))
    script = ScriptDirectory.from_config(config)
    return script.get_current_head()


def _table_names(conn: Connection) -> list[str]:
    return inspect(conn).get_table_names()


async def _stamp(conn, revision: str) -> None:
    await conn.execute(text(_VERSION_TABLE_DDL))
    await conn.execute(text("DELETE FROM alembic_version"))
    await conn.execute(
        text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": revision}
    )


async def ensure_schema_current(engine: AsyncEngine) -> None:
    """Verify the database is at the Alembic head revision before serving requests.

    Raises:
        RuntimeError: schema exists but is missing or behind head and cannot
            be auto-bootstrapped — this should fail app startup outright.
    """
    head = _head_revision()

    async with engine.connect() as conn:
        table_names = await conn.run_sync(_table_names)

        if not table_names:
            logger.info("Empty database detected; bootstrapping schema => head=%s", head)
            await conn.run_sync(Base.metadata.create_all)
            if head is not None:
                await _stamp(conn, head)
            await conn.commit()
            return

        current: str | None = None
        if "alembic_version" in table_names:
            result = await conn.execute(text("SELECT version_num FROM alembic_version"))
            current = result.scalar()

    if current != head:
        raise RuntimeError(
            f"Database schema is out of date (current={current!r}, expected head={head!r}). "
            "Run `alembic upgrade head` before starting the API."
        )
    logger.info("Database schema is current => revision=%s", head)
