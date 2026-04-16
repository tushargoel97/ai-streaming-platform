import asyncio
import logging
import os
import secrets
import socket
import uuid
from datetime import datetime, timezone

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_superadmin
from app.config import settings
from app.database import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.storage.factory import get_storage_backend
from app.utils.slug import slugify

router = APIRouter(prefix="/admin/tenants", tags=["admin-tenants"])
logger = logging.getLogger(__name__)


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
    meta_title: str = ""
    meta_description: str = ""
    meta_keywords: str = ""
    og_image_url: str = ""
    custom_domain: str = ""
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
    meta_title: str | None = None
    meta_description: str | None = None
    meta_keywords: str | None = None
    og_image_url: str | None = None
    custom_domain: str | None = None
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
        "meta_title": t.meta_title,
        "meta_description": t.meta_description,
        "meta_keywords": t.meta_keywords,
        "og_image_url": t.og_image_url,
        "custom_domain": t.custom_domain,
        "domain_verified": t.domain_verified,
        "domain_verification_token": t.domain_verification_token,
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

    # Generate verification token if custom domain is provided
    verification_token = ""
    if body.custom_domain:
        verification_token = f"streamverify-{secrets.token_hex(16)}"

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
        meta_title=body.meta_title,
        meta_description=body.meta_description,
        meta_keywords=body.meta_keywords,
        og_image_url=body.og_image_url,
        custom_domain=body.custom_domain,
        domain_verification_token=verification_token,
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

    # Generate new verification token if custom domain changes
    if "custom_domain" in update_data and update_data["custom_domain"] != tenant.custom_domain:
        if update_data["custom_domain"]:
            update_data["domain_verification_token"] = f"streamverify-{secrets.token_hex(16)}"
            update_data["domain_verified"] = False
        else:
            update_data["domain_verification_token"] = ""
            update_data["domain_verified"] = False

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


# ── Asset upload (logo / favicon / OG image) ───────────────────────────────


@router.post("/{tenant_id}/upload/{asset_type}")
async def upload_tenant_asset(
    tenant_id: uuid.UUID,
    asset_type: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Upload a branding asset (logo, favicon, og_image) for a tenant."""
    if asset_type not in ("logo", "favicon", "og_image"):
        raise HTTPException(400, "asset_type must be logo, favicon, or og_image")

    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "svg", "ico", "webp"):
        raise HTTPException(400, f"Unsupported image format: {ext}")

    storage_key = f"tenants/{tenant_id}/{asset_type}.{ext}"

    # Write to tmp then save to storage
    tmp_path = f"/tmp/{tenant_id}_{asset_type}.{ext}"
    async with aiofiles.open(tmp_path, "wb") as tmp:
        while chunk := await file.read(1024 * 1024):
            await tmp.write(chunk)

    storage = get_storage_backend()
    await storage.save_file(storage_key, tmp_path)
    os.unlink(tmp_path)

    # Resolve the public URL
    from app.storage.urls import resolve_media_url
    url = resolve_media_url(storage_key)

    # Update the tenant record
    field_map = {"logo": "logo_url", "favicon": "favicon_url", "og_image": "og_image_url"}
    setattr(tenant, field_map[asset_type], url)
    tenant.updated_at = datetime.now(timezone.utc)
    await db.flush()

    return {"url": url, "asset_type": asset_type}


# ── Custom domain / DNS verification ───────────────────────────────────────


@router.post("/{tenant_id}/verify-domain")
async def verify_domain(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Verify custom domain ownership via DNS TXT record lookup."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    if not tenant.custom_domain:
        raise HTTPException(400, "No custom domain set")

    if not tenant.domain_verification_token:
        raise HTTPException(400, "No verification token — update the custom domain to generate one")

    # DNS TXT record lookup
    domain = tenant.custom_domain
    token = tenant.domain_verification_token
    verified = False
    txt_records: list[str] = []

    try:
        loop = asyncio.get_event_loop()
        # Check _streamverify.domain.com TXT record
        answers = await loop.run_in_executor(
            None, lambda: socket.getaddrinfo(f"_streamverify.{domain}", None, socket.AF_INET, socket.SOCK_STREAM)
        )
    except (socket.gaierror, OSError):
        pass

    # Use a proper DNS query via dnspython-style fallback with socket
    try:
        import subprocess
        proc = await asyncio.create_subprocess_exec(
            "dig", "+short", "TXT", f"_streamverify.{domain}",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        for line in stdout.decode().strip().splitlines():
            record = line.strip().strip('"')
            txt_records.append(record)
            if record == token:
                verified = True
    except Exception:
        # Fallback: check CNAME pointing to our domain
        try:
            proc = await asyncio.create_subprocess_exec(
                "dig", "+short", "CNAME", domain,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            cname = stdout.decode().strip().rstrip(".")
            if cname and tenant.domain in cname:
                verified = True
        except Exception:
            logger.exception("DNS verification failed for %s", domain)

    if verified:
        tenant.domain_verified = True
        # Also update the main domain to route traffic
        tenant.domain = tenant.custom_domain
        tenant.updated_at = datetime.now(timezone.utc)
        await db.flush()

    return {
        "verified": verified,
        "domain": domain,
        "token": token,
        "txt_records_found": txt_records,
        "instruction": f'Add a TXT record: _streamverify.{domain} → "{token}"',
    }
