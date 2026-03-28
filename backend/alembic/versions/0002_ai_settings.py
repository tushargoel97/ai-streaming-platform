"""add ai_settings table

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-28 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("use_external_llm", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("external_provider", sa.String(20), server_default="anthropic", nullable=False),
        sa.Column("external_api_key", sa.Text(), server_default="", nullable=False),
        sa.Column("external_model", sa.String(100), server_default="claude-sonnet-4-5-20241022", nullable=False),
        sa.Column("local_model", sa.String(100), server_default="qwen2.5-3b", nullable=False),
        sa.Column("embedding_model", sa.String(100), server_default="all-MiniLM-L6-v2", nullable=False),
        sa.Column("auto_analyze_uploads", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("smart_search_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("recommendation_reasons", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("ai_settings")
