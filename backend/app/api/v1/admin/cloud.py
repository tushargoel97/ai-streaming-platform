"""Admin cloud storage — connect providers, browse files, import videos."""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.config import settings
from app.database import async_session, get_db, redis_pool
from app.models.cloud_connection import CloudConnection, CloudProviderConfig
from app.models.tenant import TenantVideo
from app.models.user import User
from app.models.video import Video, VideoCategory
from app.services.cloud_providers import PROVIDERS, get_provider
from app.services.transcode_service import start_transcode
from app.storage.factory import get_storage_backend
from app.utils.slug import slugify

router = APIRouter(prefix="/admin/cloud", tags=["admin-cloud"])
logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = [
    {"name": "google_drive", "display_name": "Google Drive", "icon": "google-drive"},
    {"name": "onedrive", "display_name": "OneDrive", "icon": "onedrive"},
    {"name": "dropbox", "display_name": "Dropbox", "icon": "dropbox"},
]


# ── Schemas ──

class ProviderConfigUpdate(BaseModel):
    client_id: str
    client_secret: str
    enabled: bool = True


class ConnectRequest(BaseModel):
    code: str
    redirect_uri: str


class ImportRequest(BaseModel):
    provider: str
    file_id: str
    file_name: str
    file_size: int | None = None
    title: str
    description: str = ""
    content_classification: str = "safe"
    tags: str = ""
    category_ids: list[str] = []
    tenant_ids: list[str] = []
    min_tier_level: int = 0


# ── Helpers ──

async def _get_config(db: AsyncSession, provider: str) -> CloudProviderConfig | None:
    result = await db.execute(
        select(CloudProviderConfig).where(CloudProviderConfig.provider == provider)
    )
    return result.scalar_one_or_none()


async def _get_connection(db: AsyncSession, provider: str) -> CloudConnection | None:
    result = await db.execute(
        select(CloudConnection).where(CloudConnection.provider == provider)
    )
    return result.scalar_one_or_none()


async def _ensure_valid_token(db: AsyncSession, conn: CloudConnection) -> str:
    """Return a valid access token, refreshing if expired."""
    if conn.token_expiry and conn.token_expiry < datetime.now(timezone.utc):
        config = await _get_config(db, conn.provider)
        if not config:
            raise HTTPException(400, "Provider not configured")
        provider_cls = get_provider(conn.provider)
        provider = provider_cls(config.client_id, config.client_secret)
        tokens = await provider.refresh_access_token(conn.refresh_token)
        conn.access_token = tokens.access_token
        if tokens.refresh_token:
            conn.refresh_token = tokens.refresh_token
        conn.token_expiry = tokens.expires_at
        await db.commit()
    return conn.access_token


# ── Provider config endpoints ──

@router.get("/providers")
async def list_providers(db: AsyncSession = Depends(get_db)):
    """List all cloud providers with config + connection status."""
    result = await db.execute(select(CloudProviderConfig))
    configs = {c.provider: c for c in result.scalars().all()}

    conn_result = await db.execute(select(CloudConnection))
    connections = {c.provider: c for c in conn_result.scalars().all()}

    providers = []
    for p in SUPPORTED_PROVIDERS:
        config = configs.get(p["name"])
        conn = connections.get(p["name"])
        providers.append({
            **p,
            "configured": bool(config and config.client_id),
            "enabled": bool(config and config.enabled),
            "connected": bool(conn),
            "account_email": conn.account_email if conn else None,
            "account_name": conn.account_name if conn else None,
        })
    return {"providers": providers}


@router.get("/providers/{provider}/config")
async def get_provider_config(
    provider: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Get OAuth config for a provider (client_id only, secret is masked)."""
    config = await _get_config(db, provider)
    return {
        "provider": provider,
        "client_id": config.client_id if config else "",
        "client_secret_set": bool(config and config.client_secret),
        "enabled": bool(config and config.enabled),
    }


@router.patch("/providers/{provider}/config")
async def update_provider_config(
    provider: str,
    body: ProviderConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Set OAuth credentials for a cloud provider."""
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")

    config = await _get_config(db, provider)
    if config is None:
        config = CloudProviderConfig(provider=provider)
        db.add(config)

    config.client_id = body.client_id
    config.client_secret = body.client_secret
    config.enabled = body.enabled
    config.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return {"status": "saved", "provider": provider}


# ── OAuth flow ──

@router.get("/providers/{provider}/auth-url")
async def get_auth_url(
    provider: str,
    redirect_uri: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Get the OAuth authorisation URL for a provider."""
    config = await _get_config(db, provider)
    if not config or not config.client_id:
        raise HTTPException(400, f"Provider {provider} is not configured. Set OAuth credentials first.")

    provider_cls = get_provider(provider)
    p = provider_cls(config.client_id, config.client_secret)

    state = uuid.uuid4().hex
    url = p.get_auth_url(redirect_uri, state=state)
    return {"auth_url": url, "state": state}


@router.post("/providers/{provider}/connect")
async def connect_provider(
    provider: str,
    body: ConnectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Exchange OAuth code for tokens and save the connection."""
    config = await _get_config(db, provider)
    if not config or not config.client_id:
        raise HTTPException(400, f"Provider {provider} is not configured")

    provider_cls = get_provider(provider)
    p = provider_cls(config.client_id, config.client_secret)

    try:
        tokens = await p.exchange_code(body.code, body.redirect_uri)
    except Exception as e:
        logger.exception("OAuth code exchange failed for %s", provider)
        raise HTTPException(400, f"OAuth failed: {e}")

    # Upsert connection
    conn = await _get_connection(db, provider)
    if conn is None:
        conn = CloudConnection(provider=provider, connected_by=user.id)
        db.add(conn)

    conn.access_token = tokens.access_token
    conn.refresh_token = tokens.refresh_token
    conn.token_expiry = tokens.expires_at
    conn.account_email = tokens.account_email
    conn.account_name = tokens.account_name
    conn.connected_by = user.id
    await db.commit()

    return {
        "status": "connected",
        "provider": provider,
        "account_email": tokens.account_email,
        "account_name": tokens.account_name,
    }


@router.delete("/providers/{provider}/disconnect")
async def disconnect_provider(
    provider: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Remove a connected cloud account."""
    await db.execute(
        delete(CloudConnection).where(CloudConnection.provider == provider)
    )
    await db.commit()
    return {"status": "disconnected", "provider": provider}


# ── File browsing ──

@router.get("/providers/{provider}/files")
async def list_files(
    provider: str,
    folder_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Browse files in a connected cloud storage."""
    conn = await _get_connection(db, provider)
    if not conn:
        raise HTTPException(400, f"Not connected to {provider}")

    config = await _get_config(db, provider)
    if not config:
        raise HTTPException(400, f"Provider {provider} not configured")

    access_token = await _ensure_valid_token(db, conn)

    provider_cls = get_provider(provider)
    p = provider_cls(config.client_id, config.client_secret)

    try:
        files = await p.list_files(access_token, folder_id=folder_id)
    except Exception as e:
        logger.exception("Failed to list files from %s", provider)
        raise HTTPException(502, f"Failed to list files: {e}")

    return {"files": [f.to_dict() for f in files]}


# ── Import (download from cloud → transcode) ──

@router.post("/import")
async def import_from_cloud(
    body: ImportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Import a video file from a connected cloud provider."""
    conn = await _get_connection(db, body.provider)
    if not conn:
        raise HTTPException(400, f"Not connected to {body.provider}")

    config = await _get_config(db, body.provider)
    if not config:
        raise HTTPException(400, f"Provider {body.provider} not configured")

    access_token = await _ensure_valid_token(db, conn)

    video_id = uuid.uuid4()
    ext = body.file_name.rsplit(".", 1)[-1] if "." in body.file_name else "mp4"
    storage_key = f"uploads/{video_id}/original.{ext}"

    # Create video record immediately with status="importing"
    base_slug = slugify(body.title)
    slug = f"{base_slug}-{str(video_id)[:8]}"
    tag_list = [t.strip() for t in body.tags.split(",") if t.strip()] if body.tags else []

    video = Video(
        id=video_id,
        title=body.title,
        slug=slug,
        description=body.description,
        original_filename=body.file_name,
        source_path=storage_key,
        file_size=body.file_size or 0,
        content_classification=body.content_classification,
        tags=tag_list,
        status="uploading",
        uploaded_by=user.id,
        min_tier_level=body.min_tier_level,
    )
    db.add(video)
    await db.flush()

    for cid in body.category_ids:
        try:
            db.add(VideoCategory(video_id=video_id, category_id=uuid.UUID(cid)))
        except ValueError:
            pass

    for tid in body.tenant_ids:
        try:
            db.add(TenantVideo(tenant_id=uuid.UUID(tid), video_id=video_id))
        except ValueError:
            pass

    await db.commit()

    # Download + transcode in background
    background_tasks.add_task(
        _background_import,
        provider_name=body.provider,
        client_id=config.client_id,
        client_secret=config.client_secret,
        access_token=access_token,
        refresh_token=conn.refresh_token,
        file_id=body.file_id,
        video_id=video_id,
        storage_key=storage_key,
        ext=ext,
    )

    return {
        "status": "importing",
        "video_id": str(video_id),
        "message": f"Downloading from {body.provider} and processing...",
    }


async def _background_import(
    *,
    provider_name: str,
    client_id: str,
    client_secret: str,
    access_token: str,
    refresh_token: str,
    file_id: str,
    video_id: uuid.UUID,
    storage_key: str,
    ext: str,
) -> None:
    """Background task: download from cloud → save to storage → transcode."""
    tmp_path = f"/tmp/{video_id}.{ext}"

    try:
        # Publish import progress
        await redis_pool.set(
            f"cloud_import:progress:{video_id}",
            json.dumps({"stage": "downloading", "percent": 0}),
            ex=3600,
        )

        provider_cls = get_provider(provider_name)
        provider = provider_cls(client_id, client_secret)

        # Download file from cloud
        file_size = await provider.download_file(access_token, file_id, tmp_path)

        await redis_pool.set(
            f"cloud_import:progress:{video_id}",
            json.dumps({"stage": "saving", "percent": 80}),
            ex=3600,
        )

        # Save to storage backend
        storage = get_storage_backend()
        await storage.save_file(storage_key, tmp_path)

        # Update video record
        async with async_session() as db:
            result = await db.execute(select(Video).where(Video.id == video_id))
            video = result.scalar_one_or_none()
            if video:
                video.file_size = file_size
                video.status = "processing"
                await db.commit()

        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

        await redis_pool.set(
            f"cloud_import:progress:{video_id}",
            json.dumps({"stage": "transcoding", "percent": 100}),
            ex=3600,
        )

        # Kick off transcode
        start_transcode(video_id)

    except Exception:
        logger.exception("Cloud import failed for video %s", video_id)
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

        # Mark video as failed
        try:
            async with async_session() as db:
                result = await db.execute(select(Video).where(Video.id == video_id))
                video = result.scalar_one_or_none()
                if video:
                    video.status = "failed"
                    await db.commit()
        except Exception:
            logger.exception("Failed to mark video %s as failed", video_id)

        await redis_pool.set(
            f"cloud_import:progress:{video_id}",
            json.dumps({"stage": "failed", "percent": 0}),
            ex=3600,
        )


@router.get("/import/progress/{video_id}")
async def import_progress(video_id: str, _user: User = Depends(require_admin)):
    """Get cloud import progress for a video."""
    raw = await redis_pool.get(f"cloud_import:progress:{video_id}")
    if not raw:
        return {"stage": "unknown", "percent": 0}
    return json.loads(raw)
