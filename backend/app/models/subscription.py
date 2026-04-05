import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import String, Text, Integer, Boolean, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SubscriptionTier(Base):
    """Per-tenant subscription tier (e.g., Free, Basic, Premium).
    Pricing lives in SubscriptionTierPrice — one tier, many prices across currencies/regions.
    """
    __tablename__ = "subscription_tiers"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    tier_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant: Mapped["Tenant"] = relationship()
    prices: Mapped[list["SubscriptionTierPrice"]] = relationship(
        back_populates="tier", cascade="all, delete-orphan", order_by="SubscriptionTierPrice.sort_order"
    )


class SubscriptionTierPrice(Base):
    """A price point for a subscription tier.
    One tier can have many prices in different currencies / for different regions.
    regions = [] means global default (applies when no region-specific price matches).
    """
    __tablename__ = "subscription_tier_prices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscription_tiers.id", ondelete="CASCADE"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    # ISO 3166-1 alpha-2 country codes this price applies to. Empty = global default.
    regions: Mapped[list] = mapped_column(JSONB, default=list)
    price_monthly: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    price_yearly: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    # Payment gateway price IDs (Stripe price_id, Razorpay plan_id, etc.)
    gateway_price_id_monthly: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gateway_price_id_yearly: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    tier: Mapped["SubscriptionTier"] = relationship(back_populates="prices")


class UserSubscription(Base):
    """Active subscription per user per tenant."""
    __tablename__ = "user_subscriptions"
    __table_args__ = (UniqueConstraint("user_id", "tenant_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    tier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscription_tiers.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    is_lifetime: Mapped[bool] = mapped_column(Boolean, default=False)
    billing_period: Mapped[str] = mapped_column(String(10), default="monthly")
    # Provider-agnostic identifiers
    payment_provider: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    provider_subscription_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    provider_customer_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    current_period_start: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    current_period_end: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship()
    tenant: Mapped["Tenant"] = relationship()
    tier: Mapped[Optional["SubscriptionTier"]] = relationship()


class PPVPurchase(Base):
    """Pay-per-view purchase for a live stream."""
    __tablename__ = "ppv_purchases"
    __table_args__ = (UniqueConstraint("user_id", "live_stream_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    live_stream_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("live_streams.id", ondelete="CASCADE"), nullable=False
    )
    price_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    payment_provider: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    provider_payment_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="completed")
    purchased_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    user: Mapped["User"] = relationship()
    live_stream: Mapped["LiveStream"] = relationship()


class SeasonPassConfig(Base):
    """Admin-defined season pass offering for a category."""
    __tablename__ = "season_pass_configs"
    __table_args__ = (UniqueConstraint("tenant_id", "category_id", "season_label"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), nullable=False
    )
    season_label: Mapped[str] = mapped_column(String(100), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    gateway_price_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    valid_from: Mapped[datetime] = mapped_column(nullable=False)
    valid_until: Mapped[datetime] = mapped_column(nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    tenant: Mapped["Tenant"] = relationship()
    category: Mapped["Category"] = relationship()


class SeasonPass(Base):
    """User's purchased season pass."""
    __tablename__ = "season_passes"
    __table_args__ = (UniqueConstraint("user_id", "season_pass_config_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    season_pass_config_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("season_pass_configs.id", ondelete="CASCADE"), nullable=False
    )
    price_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    payment_provider: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    provider_payment_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    purchased_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    user: Mapped["User"] = relationship()
    config: Mapped["SeasonPassConfig"] = relationship()
