import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_superadmin
from app.database import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.utils.slug import slugify

router = APIRouter(prefix="/admin/tenants", tags=["admin-tenants"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class TenantCreate(BaseModel):
    domain: str
    site_name: str
    slug: str | None = None
    description: str = ""
    logo_url: str = ""
    favicon_url: str = ""
    primary_color: str = "#E50914"
    secondary_color: str = "#141414"
    background_color: str = "#000000"
    features: dict | None = None
    max_content_level: str = "safe"
    age_verification: str = "none"
    content_rating_system: str = "mpaa"
    default_content_rating: str = ""
    payment_provider: str = ""  # stripe | razorpay | paypal
    payment_api_key: str = ""
    payment_api_secret: str = ""
    payment_webhook_secret: str = ""
    subscriptions_enabled: bool = False


class TenantUpdate(BaseModel):
    domain: str | None = None
    site_name: str | None = None
    description: str | None = None
    logo_url: str | None = None
    favicon_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    background_color: str | None = None
    features: dict | None = None
    max_content_level: str | None = None
    age_verification: str | None = None
    content_rating_system: str | None = None
    default_content_rating: str | None = None
    payment_provider: str | None = None
    payment_api_key: str | None = None
    payment_api_secret: str | None = None
    payment_webhook_secret: str | None = None
    subscriptions_enabled: bool | None = None
    is_active: bool | None = None
    maintenance_mode: bool | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_tenant(t: Tenant) -> dict:
    return {
        "id": str(t.id),
        "slug": t.slug,
        "domain": t.domain,
        "site_name": t.site_name,
        "description": t.description,
        "logo_url": t.logo_url,
        "favicon_url": t.favicon_url,
        "primary_color": t.primary_color,
        "secondary_color": t.secondary_color,
        "background_color": t.background_color,
        "features": t.features,
        "max_content_level": t.max_content_level,
        "age_verification": t.age_verification,
        "content_rating_system": t.content_rating_system,
        "default_content_rating": t.default_content_rating,
        "payment_provider": t.payment_provider,
        "payment_api_key": t.payment_api_key,
        "payment_api_secret": t.payment_api_secret,
        "payment_webhook_secret": t.payment_webhook_secret,
        "subscriptions_enabled": t.subscriptions_enabled,
        "is_active": t.is_active,
        "maintenance_mode": t.maintenance_mode,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("")
async def list_tenants(
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    query = select(Tenant)

    if search:
        query = query.where(
            Tenant.site_name.ilike(f"%{search}%") | Tenant.domain.ilike(f"%{search}%")
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Tenant.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tenants = result.scalars().all()

    return {
        "items": [_serialize_tenant(t) for t in tenants],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{tenant_id}")
async def get_tenant(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return _serialize_tenant(tenant)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    # Check domain uniqueness
    existing = await db.execute(select(Tenant).where(Tenant.domain == body.domain))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Domain already registered")

    slug = body.slug or slugify(body.site_name)

    # Check slug uniqueness
    existing = await db.execute(select(Tenant).where(Tenant.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    tenant = Tenant(
        slug=slug,
        domain=body.domain,
        site_name=body.site_name,
        description=body.description,
        logo_url=body.logo_url,
        favicon_url=body.favicon_url,
        primary_color=body.primary_color,
        secondary_color=body.secondary_color,
        background_color=body.background_color,
        features=body.features or {
            "live_streaming": True,
            "live_chat": True,
            "recommendations": True,
            "search": True,
            "watch_history": True,
        },
        max_content_level=body.max_content_level,
        age_verification=body.age_verification,
        content_rating_system=body.content_rating_system,
        default_content_rating=body.default_content_rating,
        subscriptions_enabled=body.subscriptions_enabled,
    )
    db.add(tenant)
    await db.flush()
    return _serialize_tenant(tenant)


@router.patch("/{tenant_id}")
async def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    update_data = body.model_dump(exclude_unset=True)

    # Check domain uniqueness if changing
    if "domain" in update_data and update_data["domain"] != tenant.domain:
        existing = await db.execute(
            select(Tenant).where(Tenant.domain == update_data["domain"])
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Domain already registered")

    for field, value in update_data.items():
        setattr(tenant, field, value)

    tenant.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return _serialize_tenant(tenant)


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Permanently delete a tenant and all associated data (categories, live streams, etc.)."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    await db.delete(tenant)
