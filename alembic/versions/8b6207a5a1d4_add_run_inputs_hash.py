"""Add run inputs hash.

Revision ID: 8b6207a5a1d4
Revises: 7c2ef0ef6fb8
Create Date: 2026-07-13 00:20:00.000000

"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b6207a5a1d4"
down_revision: str | Sequence[str] | None = "7c2ef0ef6fb8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_QUEUED_WHERE = sa.text("state = 'queued'")


def _run_columns() -> set[str]:
    """Return the current column names on runs."""
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("runs")}


def _canonical_inputs_hash(inputs: Mapping[str, Any] | None) -> str:
    payload = json.dumps(inputs or {}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _loads_inputs(raw: object) -> Mapping[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        decoded = json.loads(raw)
        return decoded if isinstance(decoded, dict) else None
    if isinstance(raw, dict):
        return raw
    return None


def _add_column_if_missing(column: sa.Column) -> None:
    """Add *column* to runs if this database does not already have it."""
    if column.name not in _run_columns():
        op.add_column("runs", column)


def _drop_column_if_present(name: str) -> None:
    """Drop *name* from runs if this database has it."""
    if name in _run_columns():
        op.drop_column("runs", name)


def _drop_index_if_present(name: str) -> None:
    indexes = sa.inspect(op.get_bind()).get_indexes("runs")
    if any(index["name"] == name for index in indexes):
        op.drop_index(name, table_name="runs")


def upgrade() -> None:
    """Upgrade schema."""
    _add_column_if_missing(sa.Column("inputs_hash", sa.String(), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, inputs FROM runs")).mappings().all()
    for row in rows:
        conn.execute(
            sa.text("UPDATE runs SET inputs_hash = :inputs_hash WHERE id = :id"),
            {
                "id": row["id"],
                "inputs_hash": _canonical_inputs_hash(_loads_inputs(row["inputs"])),
            },
        )
    _drop_index_if_present("uq_runs_queued_flow_inputs")
    op.create_index(
        "uq_runs_queued_flow_inputs",
        "runs",
        ["project_id", "flow", "inputs_hash"],
        unique=True,
        sqlite_where=_QUEUED_WHERE,
        postgresql_where=_QUEUED_WHERE,
    )


def downgrade() -> None:
    """Downgrade schema."""
    _drop_index_if_present("uq_runs_queued_flow_inputs")
    _drop_column_if_present("inputs_hash")
