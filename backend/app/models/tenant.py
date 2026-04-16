import uuid
from datetime import datetime

from sqlalchemy import String, Text, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    domain: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    site_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    # Branding
    logo_url: Mapped[str] = mapped_column(String(500), default="")
    favicon_url: Mapped[str] = mapped_column(String(500), default="")
    primary_color: Mapped[str] = mapped_column(String(7), default="#E50914")
    secondary_color: Mapped[str] = mapped_column(String(7), default="#141414")
    background_color: Mapped[str] = mapped_column(String(7), default="#000000")

    # SEO / metadata
    meta_title: Mapped[str] = mapped_column(String(255), default="")
    meta_description: Mapped[str] = mapped_column(Text, default="")
    meta_keywords: Mapped[str] = mapped_column(String(500), default="")
    og_image_url: Mapped[str] = mapped_column(String(500), default="")

    # Custom domain
    custom_domain: Mapped[str] = mapped_column(String(255), default="")
    domain_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    domain_verification_token: Mapped[str] = mapped_column(String(100), default="")

    # Feature toggles
    features: Mapped[dict] = mapped_column(
        JSONB,
        default=lambda: {
            "live_streaming": True,
            "live_chat": True,
            "recommendations": True,
            "search": True,
            "watch_history": True,
        },
    )

    # Content safety
    max_content_level: Mapped[str] = mapped_column(String(10), nullable=False, default="safe")

    # Content settings
    age_verification: Mapped[str] = mapped_column(String(20), default="none")
    content_rating_system: Mapped[str] = mapped_column(String(20), default="mpaa")
    default_content_rating: Mapped[str] = mapped_column(String(10), default="")

    # Payment gateway (per-tenant white-label payments)
    payment_provider: Mapped[str] = mapped_column(String(20), default="")  # stripe | razorpay | paypal
    payment_api_key: Mapped[str] = mapped_column(String(255), default="")
    payment_api_secret: Mapped[str] = mapped_column(String(255), default="")
    payment_webhook_secret: Mapped[str] = mapped_column(String(255), default="")

    # Subscription / pass toggle
    subscriptions_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    maintenance_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    categories: Mapped[list["Category"]] = relationship(back_populates="tenant")
    live_streams: Mapped[list["LiveStream"]] = relationship(back_populates="tenant")


class TenantVideo(Base):
    __tablename__ = "tenant_videos"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    content_rating: Mapped[str] = mapped_column(String(10), default="")


class TenantSeries(Base):
    __tablename__ = "tenant_series"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
