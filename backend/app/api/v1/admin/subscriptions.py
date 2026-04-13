import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import require_admin
from app.database import get_db
from app.models.subscription import (
    PPVPurchase,
    SeasonPass,
    SeasonPassConfig,
    SubscriptionTier,
    SubscriptionTierPrice,
    UserSubscription,
)
from app.models.user import User
from app.tenant.context import get_tenant_id

router = APIRouter(prefix="/admin/subscriptions", tags=["admin-subscriptions"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class TierPriceInput(BaseModel):
    """One price point in a create/update payload."""
    currency: str = "USD"
    regions: list[str] = []          # empty = global default
    price_monthly: Decimal = Decimal("0")
    price_yearly: Decimal = Decimal("0")
    gateway_price_id_monthly: str | None = None
    gateway_price_id_yearly: str | None = None
    is_default: bool = False
    sort_order: int = 0


class TierCreate(BaseModel):
    name: str
    slug: str
    tier_level: int = 0
    description: str = ""
    features: dict | None = None
    is_active: bool = True
    sort_order: int = 0
    prices: list[TierPriceInput] = []


class TierUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    tier_level: int | None = None
    description: str | None = None
    features: dict | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    prices: list[TierPriceInput] | None = None  # if provided, replaces all prices


class GrantSubscription(BaseModel):
    user_id: uuid.UUID
    tier_id: uuid.UUID
    is_lifetime: bool = False
    billing_period: str = "monthly"


class RevokeSubscription(BaseModel):
    user_id: uuid.UUID


class SeasonPassConfigCreate(BaseModel):
    category_id: uuid.UUID
    season_label: str
    price: Decimal
    currency: str = "USD"
    gateway_price_id: str | None = None
    valid_from: datetime
    valid_until: datetime
    is_active: bool = True


class SeasonPassConfigUpdate(BaseModel):
    season_label: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    gateway_price_id: str | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    is_active: bool | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_price(p: SubscriptionTierPrice) -> dict:
    return {
        "id": str(p.id),
        "currency": p.currency,
        "regions": p.regions or [],
        "price_monthly": str(p.price_monthly),
        "price_yearly": str(p.price_yearly),
        "gateway_price_id_monthly": p.gateway_price_id_monthly,
        "gateway_price_id_yearly": p.gateway_price_id_yearly,
        "is_default": p.is_default,
        "sort_order": p.sort_order,
    }


def _serialize_tier(t: SubscriptionTier) -> dict:
    return {
        "id": str(t.id),
        "tenant_id": str(t.tenant_id),
        "name": t.name,
        "slug": t.slug,
        "tier_level": t.tier_level,
        "description": t.description,
        "features": t.features,
        "is_active": t.is_active,
        "sort_order": t.sort_order,
        "prices": [_serialize_price(p) for p in (t.prices or [])],
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _serialize_user_sub(s: UserSubscription) -> dict:
    return {
        "id": str(s.id),
        "user_id": str(s.user_id),
        "tenant_id": str(s.tenant_id),
        "tier_id": str(s.tier_id) if s.tier_id else None,
        "tier_name": s.tier.name if s.tier else None,
        "status": s.status,
        "is_lifetime": s.is_lifetime,
        "billing_period": s.billing_period,
        "payment_provider": s.payment_provider,
        "provider_subscription_id": s.provider_subscription_id,
        "provider_customer_id": s.provider_customer_id,
        "current_period_start": s.current_period_start.isoformat() if s.current_period_start else None,
        "current_period_end": s.current_period_end.isoformat() if s.current_period_end else None,
        "cancelled_at": s.cancelled_at.isoformat() if s.cancelled_at else None,
        "user_email": s.user.email if s.user else None,
        "user_username": s.user.username if s.user else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _serialize_season_pass_config(c: SeasonPassConfig) -> dict:
    return {
        "id": str(c.id),
        "tenant_id": str(c.tenant_id),
        "category_id": str(c.category_id),
        "category_name": c.category.name if c.category else "",
        "season_label": c.season_label,
        "price": str(c.price),
        "currency": c.currency,
        "gateway_price_id": c.gateway_price_id,
        "valid_from": c.valid_from.isoformat() if c.valid_from else None,
        "valid_until": c.valid_until.isoformat() if c.valid_until else None,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


# ── Tier Endpoints ───────────────────────────────────────────────────────────


@router.get("/tiers")
async def list_tiers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()
    query = (
        select(SubscriptionTier)
        .where(SubscriptionTier.tenant_id == tid)
        .options(selectinload(SubscriptionTier.prices))
        .order_by(SubscriptionTier.sort_order, SubscriptionTier.tier_level)
    )
    result = await db.execute(query)
    tiers = result.scalars().all()
    return {"items": [_serialize_tier(t) for t in tiers]}


@router.post("/tiers", status_code=status.HTTP_201_CREATED)
async def create_tier(
    body: TierCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()

    # Check slug uniqueness within tenant
    existing = await db.execute(
        select(SubscriptionTier).where(
            SubscriptionTier.tenant_id == tid,
            SubscriptionTier.slug == body.slug,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Tier slug already exists for this tenant")

    tier = SubscriptionTier(
        tenant_id=tid,
        name=body.name,
        slug=body.slug,
        tier_level=body.tier_level,
        description=body.description,
        features=body.features or {},
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(tier)
    await db.flush()

    for i, p in enumerate(body.prices):
        db.add(SubscriptionTierPrice(
            tier_id=tier.id,
            currency=p.currency.upper(),
            regions=[r.upper() for r in p.regions],
            price_monthly=p.price_monthly,
            price_yearly=p.price_yearly,
            gateway_price_id_monthly=p.gateway_price_id_monthly,
            gateway_price_id_yearly=p.gateway_price_id_yearly,
            is_default=p.is_default,
            sort_order=p.sort_order if p.sort_order else i,
        ))

    await db.flush()
    await db.refresh(tier, ["prices"])
    return _serialize_tier(tier)


@router.patch("/tiers/{tier_id}")
async def update_tier(
    tier_id: uuid.UUID,
    body: TierUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(SubscriptionTier)
        .where(SubscriptionTier.id == tier_id)
        .options(selectinload(SubscriptionTier.prices))
    )
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")

    update_data = body.model_dump(exclude_unset=True)
    prices_input = update_data.pop("prices", None)

    # Check slug uniqueness if changing
    if "slug" in update_data and update_data["slug"] != tier.slug:
        existing = await db.execute(
            select(SubscriptionTier).where(
                SubscriptionTier.tenant_id == tier.tenant_id,
                SubscriptionTier.slug == update_data["slug"],
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Tier slug already exists for this tenant")

    for field, value in update_data.items():
        setattr(tier, field, value)

    # Replace all prices if provided
    if prices_input is not None:
        for old_price in list(tier.prices):
            await db.delete(old_price)
        await db.flush()
        for i, p in enumerate(prices_input):
            db.add(SubscriptionTierPrice(
                tier_id=tier.id,
                currency=p["currency"].upper(),
                regions=[r.upper() for r in p.get("regions", [])],
                price_monthly=p["price_monthly"],
                price_yearly=p["price_yearly"],
                gateway_price_id_monthly=p.get("gateway_price_id_monthly"),
                gateway_price_id_yearly=p.get("gateway_price_id_yearly"),
                is_default=p.get("is_default", False),
                sort_order=p.get("sort_order", i),
            ))

    tier.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(tier, ["prices"])
    return _serialize_tier(tier)


@router.delete("/tiers/{tier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tier(
    tier_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(SubscriptionTier).where(SubscriptionTier.id == tier_id))
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")
    await db.delete(tier)


# ── User Subscription Endpoints (admin grant/revoke) ────────────────────────


@router.get("/users")
async def list_user_subscriptions(
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()
    query = (
        select(UserSubscription)
        .where(UserSubscription.tenant_id == tid)
        .options(selectinload(UserSubscription.user), selectinload(UserSubscription.tier))
    )

    if search:
        query = query.join(UserSubscription.user).where(
            User.email.ilike(f"%{search}%") | User.username.ilike(f"%{search}%")
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(UserSubscription.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    subs = result.scalars().all()

    return {
        "items": [_serialize_user_sub(s) for s in subs],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/grant", status_code=status.HTTP_201_CREATED)
async def grant_subscription(
    body: GrantSubscription,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()

    # Verify user exists
    target_user = await db.execute(select(User).where(User.id == body.user_id))
    if not target_user.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    # Verify tier exists and belongs to tenant
    tier = await db.execute(
        select(SubscriptionTier).where(
            SubscriptionTier.id == body.tier_id,
            SubscriptionTier.tenant_id == tid,
        )
    )
    if not tier.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Tier not found for this tenant")

    # Check if user already has a subscription for this tenant
    existing = await db.execute(
        select(UserSubscription).where(
            UserSubscription.user_id == body.user_id,
            UserSubscription.tenant_id == tid,
        )
    )
    sub = existing.scalar_one_or_none()

    if sub:
        # Update existing subscription
        sub.tier_id = body.tier_id
        sub.is_lifetime = body.is_lifetime
        sub.billing_period = body.billing_period
        sub.status = "active"
        sub.cancelled_at = None
        sub.updated_at = datetime.now(timezone.utc)
    else:
        sub = UserSubscription(
            user_id=body.user_id,
            tenant_id=tid,
            tier_id=body.tier_id,
            status="active",
            is_lifetime=body.is_lifetime,
            billing_period=body.billing_period,
        )
        db.add(sub)

    await db.flush()
    await db.refresh(sub, ["user", "tier"])
    return _serialize_user_sub(sub)


@router.post("/revoke")
async def revoke_subscription(
    body: RevokeSubscription,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()

    result = await db.execute(
        select(UserSubscription)
        .where(
            UserSubscription.user_id == body.user_id,
            UserSubscription.tenant_id == tid,
        )
        .options(selectinload(UserSubscription.user), selectinload(UserSubscription.tier))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found for this user")

    sub.status = "cancelled"
    sub.cancelled_at = datetime.now(timezone.utc)
    sub.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return _serialize_user_sub(sub)


@router.delete("/users/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_subscription(
    subscription_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(UserSubscription).where(UserSubscription.id == subscription_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    await db.delete(sub)


# ── Season Pass Config Endpoints ─────────────────────────────────────────────


@router.get("/season-passes")
async def list_season_pass_configs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()
    query = (
        select(SeasonPassConfig)
        .where(SeasonPassConfig.tenant_id == tid)
        .options(selectinload(SeasonPassConfig.category))
        .order_by(SeasonPassConfig.created_at.desc())
    )
    result = await db.execute(query)
    configs = result.scalars().all()
    return {"items": [_serialize_season_pass_config(c) for c in configs]}


@router.post("/season-passes", status_code=status.HTTP_201_CREATED)
async def create_season_pass_config(
    body: SeasonPassConfigCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()

    config = SeasonPassConfig(
        tenant_id=tid,
        category_id=body.category_id,
        season_label=body.season_label,
        price=body.price,
        currency=body.currency,
        gateway_price_id=body.gateway_price_id,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        is_active=body.is_active,
    )
    db.add(config)
    await db.flush()
    await db.refresh(config, ["category"])
    return _serialize_season_pass_config(config)


@router.patch("/season-passes/{config_id}")
async def update_season_pass_config(
    config_id: uuid.UUID,
    body: SeasonPassConfigUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(SeasonPassConfig)
        .where(SeasonPassConfig.id == config_id)
        .options(selectinload(SeasonPassConfig.category))
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Season pass config not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    await db.flush()
    await db.refresh(config, ["category"])
    return _serialize_season_pass_config(config)


@router.delete("/season-passes/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_season_pass_config(
    config_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(SeasonPassConfig).where(SeasonPassConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Season pass config not found")
    await db.delete(config)
