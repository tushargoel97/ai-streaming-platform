"""create cloud_provider_configs and cloud_connections tables

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-15 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cloud_provider_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider", sa.String(30), unique=True, nullable=False),
        sa.Column("client_id", sa.String(500), nullable=False, server_default=""),
        sa.Column("client_secret", sa.Text, nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "cloud_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("access_token", sa.Text, nullable=False, server_default=""),
        sa.Column("refresh_token", sa.Text, nullable=False, server_default=""),
        sa.Column("token_expiry", sa.DateTime, nullable=True),
        sa.Column("account_email", sa.String(255), nullable=False, server_default=""),
        sa.Column("account_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("connected_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_cloud_connections_provider", "cloud_connections", ["provider"])


def downgrade() -> None:
    op.drop_index("ix_cloud_connections_provider", "cloud_connections")
    op.drop_table("cloud_connections")
    op.drop_table("cloud_provider_configs")
