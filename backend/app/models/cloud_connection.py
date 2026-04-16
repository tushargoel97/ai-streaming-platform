"""Cloud storage provider connections — OAuth tokens + provider config."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CloudProviderConfig(Base):
    """Admin-managed OAuth credentials for each cloud provider."""

    __tablename__ = "cloud_provider_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)  # google_drive | onedrive | dropbox
    client_id: Mapped[str] = mapped_column(String(500), default="")
    client_secret: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc),
    )


class CloudConnection(Base):
    """A connected cloud storage account (one per provider)."""

    __tablename__ = "cloud_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    access_token: Mapped[str] = mapped_column(Text, default="")
    refresh_token: Mapped[str] = mapped_column(Text, default="")
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    account_email: Mapped[str] = mapped_column(String(255), default="")
    account_name: Mapped[str] = mapped_column(String(255), default="")
    connected_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
