"""create subscription_tier_prices table

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscription_tier_prices",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tier_id", UUID(as_uuid=True), sa.ForeignKey("subscription_tiers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("regions", JSONB, nullable=False, server_default="[]"),
        sa.Column("price_monthly", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("price_yearly", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("gateway_price_id_monthly", sa.String(255), nullable=True),
        sa.Column("gateway_price_id_yearly", sa.String(255), nullable=True),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_subscription_tier_prices_tier_id", "subscription_tier_prices", ["tier_id"])


def downgrade() -> None:
    op.drop_index("ix_subscription_tier_prices_tier_id", "subscription_tier_prices")
    op.drop_table("subscription_tier_prices")
