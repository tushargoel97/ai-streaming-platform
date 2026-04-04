"""add intro_start and intro_end to videos

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-04 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("intro_start", sa.Float(), nullable=True))
    op.add_column("videos", sa.Column("intro_end", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "intro_end")
    op.drop_column("videos", "intro_start")
