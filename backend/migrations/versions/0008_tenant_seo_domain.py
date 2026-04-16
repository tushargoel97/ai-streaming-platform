"""add SEO metadata and custom domain fields to tenants

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-16 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("meta_title", sa.String(255), nullable=False, server_default=""))
    op.add_column("tenants", sa.Column("meta_description", sa.Text, nullable=False, server_default=""))
    op.add_column("tenants", sa.Column("meta_keywords", sa.String(500), nullable=False, server_default=""))
    op.add_column("tenants", sa.Column("og_image_url", sa.String(500), nullable=False, server_default=""))
    op.add_column("tenants", sa.Column("custom_domain", sa.String(255), nullable=False, server_default=""))
    op.add_column("tenants", sa.Column("domain_verified", sa.Boolean, nullable=False, server_default="false"))
    op.add_column("tenants", sa.Column("domain_verification_token", sa.String(100), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("tenants", "domain_verification_token")
    op.drop_column("tenants", "domain_verified")
    op.drop_column("tenants", "custom_domain")
    op.drop_column("tenants", "og_image_url")
    op.drop_column("tenants", "meta_keywords")
    op.drop_column("tenants", "meta_description")
    op.drop_column("tenants", "meta_title")
