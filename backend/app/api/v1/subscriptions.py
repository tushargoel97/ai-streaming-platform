"""Public subscription API.

Endpoints:
  GET  /subscriptions/tiers          — list active tiers for current tenant
  GET  /subscriptions/me             — get current user's subscription
  POST /subscriptions/checkout       — create checkout session (any payment gateway)
  POST /subscriptions/ppv-checkout   — create PPV checkout session
  POST /subscriptions/webhook        — payment gateway webhook handler
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import get_current_user, optional_user
from app.database import get_db
from app.models.live import LiveStream
from app.models.subscription import (
    PPVPurchase,
    SeasonPass,
    SeasonPassConfig,
    SubscriptionTier,
    SubscriptionTierPrice,
    UserSubscription,
)
from app.models.user import User
from app.payments.factory import get_tenant_payment_backend, get_webhook_secret

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class CheckoutRequest(BaseModel):
    tier_id: uuid.UUID
    billing_period: str = "monthly"  # monthly | yearly
    success_url: str
    cancel_url: str


class PPVCheckoutRequest(BaseModel):
    live_stream_id: uuid.UUID
    success_url: str
    cancel_url: str


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_price(p: SubscriptionTierPrice) -> dict:
    return {
        "currency": p.currency,
        "regions": p.regions or [],
        "price_monthly": str(p.price_monthly),
        "price_yearly": str(p.price_yearly),
        "is_default": p.is_default,
    }


def _serialize_tier(t: SubscriptionTier) -> dict:
    prices = t.prices or []
    default_price = next((p for p in prices if p.is_default), prices[0] if prices else None)
    return {
        "id": str(t.id),
        "name": t.name,
        "slug": t.slug,
        "tier_level": t.tier_level,
        "price_monthly": str(default_price.price_monthly) if default_price else "0",
        "price_yearly": str(default_price.price_yearly) if default_price else "0",
        "currency": default_price.currency if default_price else "USD",
        "description": t.description,
        "features": t.features,
        "sort_order": t.sort_order,
        "prices": [_serialize_price(p) for p in prices],
    }


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/tiers")
async def list_tiers(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List active subscription tiers for the current tenant."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return {"items": []}

    result = await db.execute(
        select(SubscriptionTier)
        .where(
            SubscriptionTier.tenant_id == tenant.id,
            SubscriptionTier.is_active == True,
        )
        .options(selectinload(SubscriptionTier.prices))
        .order_by(SubscriptionTier.sort_order, SubscriptionTier.tier_level)
    )
    tiers = result.scalars().all()
    return {"items": [_serialize_tier(t) for t in tiers]}


@router.get("/me")
async def get_my_subscription(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get the current user's subscription for this tenant."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return {"subscription": None}

    result = await db.execute(
        select(UserSubscription)
        .where(
            UserSubscription.user_id == user.id,
            UserSubscription.tenant_id == tenant.id,
        )
        .options(selectinload(UserSubscription.tier))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return {"subscription": None}

    return {
        "subscription": {
            "id": str(sub.id),
            "tier_id": str(sub.tier_id) if sub.tier_id else None,
            "tier_name": sub.tier.name if sub.tier else None,
            "tier_level": sub.tier.tier_level if sub.tier else 0,
            "status": sub.status,
            "is_lifetime": sub.is_lifetime,
            "billing_period": sub.billing_period,
            "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        }
    }


@router.get("/access/{video_id}")
async def check_video_access(
    video_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    """Check if user has access to a specific video based on subscription tier."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return {"has_access": True, "reason": "no_tenant"}

    # Import here to avoid circular
    from app.models.video import Video
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Free content is always accessible
    if video.min_tier_level == 0:
        return {"has_access": True, "reason": "free"}

    # Admins bypass subscription gating
    if user and user.role in ("admin", "superadmin"):
        return {"has_access": True, "reason": "admin"}

    # Not logged in
    if not user:
        return {"has_access": False, "reason": "login_required", "min_tier_level": video.min_tier_level}

    # Check user subscription
    sub_result = await db.execute(
        select(UserSubscription)
        .where(
            UserSubscription.user_id == user.id,
            UserSubscription.tenant_id == tenant.id,
            UserSubscription.status == "active",
        )
        .options(selectinload(UserSubscription.tier))
    )
    sub = sub_result.scalar_one_or_none()

    if not sub or not sub.tier:
        return {"has_access": False, "reason": "no_subscription", "min_tier_level": video.min_tier_level}

    if sub.tier.tier_level >= video.min_tier_level:
        return {"has_access": True, "reason": "subscribed"}

    return {
        "has_access": False,
        "reason": "tier_too_low",
        "current_tier_level": sub.tier.tier_level,
        "min_tier_level": video.min_tier_level,
    }


@router.get("/ppv-access/{stream_id}")
async def check_ppv_access(
    stream_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    """Check if user has PPV access to a live stream."""
    tenant = getattr(request.state, "tenant", None)

    # Check if stream is PPV
    stream_result = await db.execute(select(LiveStream).where(LiveStream.id == stream_id))
    stream = stream_result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    if not stream.is_ppv:
        return {"has_access": True, "reason": "free_stream"}

    if not user:
        return {
            "has_access": False,
            "reason": "login_required",
            "ppv_price": str(stream.ppv_price) if stream.ppv_price else None,
            "ppv_currency": stream.ppv_currency,
        }

    # Check PPV purchase
    purchase_result = await db.execute(
        select(PPVPurchase).where(
            PPVPurchase.user_id == user.id,
            PPVPurchase.live_stream_id == stream_id,
            PPVPurchase.status == "completed",
        )
    )
    if purchase_result.scalar_one_or_none():
        return {"has_access": True, "reason": "purchased"}

    # Check season pass
    if stream.category_id and tenant:
        config_result = await db.execute(
            select(SeasonPassConfig).where(
                SeasonPassConfig.tenant_id == tenant.id,
                SeasonPassConfig.category_id == stream.category_id,
                SeasonPassConfig.is_active == True,
            )
        )
        configs = config_result.scalars().all()
        for config in configs:
            pass_result = await db.execute(
                select(SeasonPass).where(
                    SeasonPass.user_id == user.id,
                    SeasonPass.season_pass_config_id == config.id,
                    SeasonPass.status == "active",
                )
            )
            if pass_result.scalar_one_or_none():
                return {"has_access": True, "reason": "season_pass"}

    return {
        "has_access": False,
        "reason": "not_purchased",
        "ppv_price": str(stream.ppv_price) if stream.ppv_price else None,
        "ppv_currency": stream.ppv_currency,
    }


@router.post("/checkout")
async def create_subscription_checkout(
    body: CheckoutRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a checkout session for subscribing to a tier (any payment gateway)."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="No tenant context")

    result = await db.execute(
        select(SubscriptionTier).where(
            SubscriptionTier.id == body.tier_id,
            SubscriptionTier.tenant_id == tenant.id,
            SubscriptionTier.is_active == True,
        )
    )
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")

    price_id = (
        tier.gateway_price_id_monthly if body.billing_period == "monthly"
        else tier.gateway_price_id_yearly
    )
    if not price_id:
        raise HTTPException(
            status_code=400,
            detail=f"No price ID configured for {tier.name} ({body.billing_period})",
        )

    backend = get_tenant_payment_backend(tenant)
    checkout = await backend.create_subscription_checkout(
        user_id=str(user.id),
        tenant_id=str(tenant.id),
        tier_id=str(tier.id),
        price_id=price_id,
        billing_period=body.billing_period,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    return checkout


@router.post("/ppv-checkout")
async def create_ppv_checkout_session(
    body: PPVCheckoutRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a checkout session for a PPV purchase (any payment gateway)."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="No tenant context")

    result = await db.execute(select(LiveStream).where(LiveStream.id == body.live_stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    if not stream.is_ppv:
        raise HTTPException(status_code=400, detail="Stream is not PPV")
    if not stream.ppv_price:
        raise HTTPException(status_code=400, detail="PPV price not configured")

    backend = get_tenant_payment_backend(tenant)
    checkout = await backend.create_one_time_checkout(
        user_id=str(user.id),
        tenant_id=str(tenant.id),
        amount=int(stream.ppv_price * 100),
        currency=stream.ppv_currency,
        description="Pay-Per-View Access",
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        metadata={
            "live_stream_id": str(stream.id),
            "type": "ppv",
        },
    )
    return checkout


@router.post("/webhook")
async def payment_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle payment gateway webhook events (Stripe, Razorpay, PayPal)."""
    body = await request.body()
    tenant = getattr(request.state, "tenant", None)

    backend = get_tenant_payment_backend(tenant)
    webhook_secret = get_webhook_secret(tenant)

    # Get signature header (varies by provider)
    sig = (
        request.headers.get("stripe-signature")
        or request.headers.get("x-razorpay-signature")
        or request.headers.get("paypal-transmission-sig")
        or ""
    )

    if not webhook_secret:
        from app.config import settings
        if settings.app_env == "production":
            raise HTTPException(status_code=503, detail="Webhook verification not configured")
        # Dev mode — parse directly
        import json
        event = json.loads(body)
    elif not sig:
        raise HTTPException(status_code=400, detail="Missing webhook signature header")
    else:
        event = await backend.verify_webhook(
            body=body,
            signature=sig,
            webhook_secret=webhook_secret,
        )
        if event is None:
            raise HTTPException(status_code=400, detail="Invalid webhook signature")

    # Extract standardized checkout data
    checkout_data = backend.extract_checkout_completed(event)
    if checkout_data:
        await _handle_checkout_completed(checkout_data, backend.provider_name, db)
        await db.commit()

    return {"status": "ok"}


async def _handle_checkout_completed(
    data: dict,
    provider_name: str,
    db: AsyncSession,
) -> None:
    """Process a completed checkout from any payment provider."""
    from datetime import datetime, timezone

    metadata = data.get("metadata", {})
    user_id = metadata.get("user_id")
    tenant_id = metadata.get("tenant_id")

    if not user_id or not tenant_id:
        return

    if metadata.get("type") == "ppv":
        # PPV purchase
        stream_id = metadata.get("live_stream_id")
        if not stream_id:
            return

        existing = await db.execute(
            select(PPVPurchase).where(
                PPVPurchase.user_id == uuid.UUID(user_id),
                PPVPurchase.live_stream_id == uuid.UUID(stream_id),
            )
        )
        if existing.scalar_one_or_none():
            return  # Already purchased

        purchase = PPVPurchase(
            user_id=uuid.UUID(user_id),
            live_stream_id=uuid.UUID(stream_id),
            price_paid=data.get("amount_total", 0) / 100,
            currency=data.get("currency", "USD"),
            payment_provider=provider_name,
            provider_payment_id=data.get("provider_payment_id"),
            status="completed",
        )
        db.add(purchase)
    else:
        # Subscription
        tier_id = metadata.get("tier_id")
        billing_period = metadata.get("billing_period", "monthly")

        if not tier_id:
            return

        existing = await db.execute(
            select(UserSubscription).where(
                UserSubscription.user_id == uuid.UUID(user_id),
                UserSubscription.tenant_id == uuid.UUID(tenant_id),
            )
        )
        sub = existing.scalar_one_or_none()
        if sub:
            sub.tier_id = uuid.UUID(tier_id)
            sub.status = "active"
            sub.billing_period = billing_period
            sub.payment_provider = provider_name
            sub.provider_subscription_id = data.get("provider_subscription_id")
            sub.provider_customer_id = data.get("provider_customer_id")
            sub.updated_at = datetime.now(timezone.utc)
        else:
            sub = UserSubscription(
                user_id=uuid.UUID(user_id),
                tenant_id=uuid.UUID(tenant_id),
                tier_id=uuid.UUID(tier_id),
                status="active",
                billing_period=billing_period,
                payment_provider=provider_name,
                provider_subscription_id=data.get("provider_subscription_id"),
                provider_customer_id=data.get("provider_customer_id"),
            )
            db.add(sub)

    await db.flush()
