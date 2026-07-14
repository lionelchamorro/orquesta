"""Add run queue launch params.

Revision ID: 7c2ef0ef6fb8
Revises: 1f6d0dfba0c1
Create Date: 2026-07-10 00:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c2ef0ef6fb8"
down_revision: str | Sequence[str] | None = "1f6d0dfba0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_OLD_ACTIVE_WHERE = sa.text("state IN ('queued', 'starting', 'running', 'stopping')")
_PROCESS_ACTIVE_WHERE = sa.text("state IN ('starting', 'running', 'stopping')")


def _run_columns() -> set[str]:
    """Return the current column names on runs."""
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("runs")}


def _add_column_if_missing(column: sa.Column) -> None:
    """Add *column* to runs if this database does not already have it."""
    if column.name not in _run_columns():
        op.add_column("runs", column)


def _drop_column_if_present(name: str) -> None:
    """Drop *name* from runs if this database has it."""
    if name in _run_columns():
        op.drop_column("runs", name)


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index("uq_runs_one_active_per_project", table_name="runs")
    _add_column_if_missing(sa.Column("created_at", sa.DateTime(), nullable=True))
    _add_column_if_missing(sa.Column("queued_at", sa.DateTime(), nullable=True))
    _add_column_if_missing(sa.Column("flow", sa.String(), nullable=True))
    _add_column_if_missing(sa.Column("inputs", sa.JSON(), nullable=True))
    _add_column_if_missing(sa.Column("plan_path", sa.String(), nullable=True))
    _add_column_if_missing(sa.Column("args", sa.JSON(), nullable=True))
    op.create_index(
        "uq_runs_one_active_per_project",
        "runs",
        ["project_id"],
        unique=True,
        sqlite_where=_PROCESS_ACTIVE_WHERE,
        postgresql_where=_PROCESS_ACTIVE_WHERE,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_runs_one_active_per_project", table_name="runs")
    _drop_column_if_present("args")
    _drop_column_if_present("plan_path")
    _drop_column_if_present("inputs")
    _drop_column_if_present("flow")
    _drop_column_if_present("queued_at")
    _drop_column_if_present("created_at")
    op.create_index(
        "uq_runs_one_active_per_project",
        "runs",
        ["project_id"],
        unique=True,
        sqlite_where=_OLD_ACTIVE_WHERE,
        postgresql_where=_OLD_ACTIVE_WHERE,
    )
