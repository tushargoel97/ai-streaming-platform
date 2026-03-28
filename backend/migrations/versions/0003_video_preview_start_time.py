"""add preview_start_time to videos

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "videos",
        sa.Column("preview_start_time", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("videos", "preview_start_time")
