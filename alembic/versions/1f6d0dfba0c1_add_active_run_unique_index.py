"""add active run unique index

Revision ID: 1f6d0dfba0c1
Revises: 094d421180c8
Create Date: 2026-07-09 23:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1f6d0dfba0c1'
down_revision: Union[str, Sequence[str], None] = '094d421180c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ACTIVE_RUN_STATES = "'queued', 'starting', 'running', 'stopping'"
_ACTIVE_RUN_WHERE = sa.text(f"state IN ({_ACTIVE_RUN_STATES})")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "uq_runs_one_active_per_project",
        "runs",
        ["project_id"],
        unique=True,
        sqlite_where=_ACTIVE_RUN_WHERE,
        postgresql_where=_ACTIVE_RUN_WHERE,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_runs_one_active_per_project", table_name="runs")
