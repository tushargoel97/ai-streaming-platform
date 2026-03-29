"""add scene_analysis_model to ai_settings

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ai_settings",
        sa.Column("scene_analysis_model", sa.String(100), nullable=False, server_default="qwen2.5-vl-7b"),
    )


def downgrade() -> None:
    op.drop_column("ai_settings", "scene_analysis_model")
