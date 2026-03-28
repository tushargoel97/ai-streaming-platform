"""Public live streaming API + RTMP webhook handlers.

Public endpoints:
  GET  /live/streams          — list active streams
  GET  /live/streams/{id}     — stream detail

RTMP webhooks (called by nginx-rtmp on_publish / on_publish_done):
  POST /live/hooks/on_publish      — validate stream key, set status=live
  POST /live/hooks/on_publish_done — set status=ended, clean up
"""

import os
import shutil
import uuid

from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.auth.permissions import optional_user
from app.config import settings
from app.database import get_db
from app.models.live import LiveStream
from app.models.subscription import PPVPurchase, SeasonPass, SeasonPassConfig
from app.models.user import User
from app.schemas.live import LiveStreamPublic

router = APIRouter(prefix="/live", tags=["live"])


def _resolve_live_url(stream_key: str) -> str:
    """Build the public HLS manifest URL for a live stream."""
    return f"/live/{stream_key}/master.m3u8"


def _build_public(stream: LiveStream, *, hide_manifest: bool = False) -> dict:
    """Serialize a LiveStream for public response."""
    show_manifest = stream.status == "live" and not hide_manifest
    return {
        "id": stream.id,
        "title": stream.title,
        "description": stream.description,
        "status": stream.status,
        "category_id": stream.category_id,
        "category_name": stream.category.name if stream.category else "",
        "manifest_url": _resolve_live_url(stream.stream_key) if show_manifest else "",
        "thumbnail_url": "",
        "viewer_count": stream.viewer_count,
        "started_at": stream.started_at,
        "is_ppv": stream.is_ppv,
        "ppv_price": str(stream.ppv_price) if stream.ppv_price is not None else None,
        "ppv_currency": stream.ppv_currency,
    }


# ─── Public Endpoints ────────────────────────────────────────────────────────


@router.get("/streams", response_model=list[LiveStreamPublic])
async def list_live_streams(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all currently live streams for the current tenant."""
    tenant = getattr(request.state, "tenant", None)
    query = select(LiveStream).options(selectinload(LiveStream.category)).where(LiveStream.status == "live")
    if tenant:
        query = query.where(LiveStream.tenant_id == tenant.id)
    query = query.order_by(LiveStream.started_at.desc())
    result = await db.execute(query)
    streams = result.scalars().all()
    return [_build_public(s) for s in streams]


@router.get("/streams/{stream_id}")
async def get_live_stream(
    stream_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    """Get details for a single live stream. PPV streams hide manifest without purchase."""
    result = await db.execute(select(LiveStream).options(selectinload(LiveStream.category)).where(LiveStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    # Non-PPV streams are always accessible
    if not stream.is_ppv:
        data = _build_public(stream)
        data["access"] = {"has_access": True, "reason": "free_stream"}
        return data

    # PPV stream — check access
    if not user:
        data = _build_public(stream, hide_manifest=True)
        data["access"] = {"has_access": False, "reason": "login_required"}
        return data

    # Check PPV purchase
    purchase_result = await db.execute(
        select(PPVPurchase).where(
            PPVPurchase.user_id == user.id,
            PPVPurchase.live_stream_id == stream_id,
            PPVPurchase.status == "completed",
        )
    )
    if purchase_result.scalar_one_or_none():
        data = _build_public(stream)
        data["access"] = {"has_access": True, "reason": "purchased"}
        return data

    # Check season pass
    tenant = getattr(request.state, "tenant", None)
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
                data = _build_public(stream)
                data["access"] = {"has_access": True, "reason": "season_pass"}
                return data

    # No access
    data = _build_public(stream, hide_manifest=True)
    data["access"] = {"has_access": False, "reason": "not_purchased"}
    return data


# ─── RTMP Webhook Handlers ───────────────────────────────────────────────────
# nginx-rtmp sends form-encoded POST with fields: name, addr, etc.
# "name" is the stream key used in the RTMP URL.
# Return 2xx to allow, 4xx to reject.


def _generate_master_playlist(stream_key: str) -> None:
    """Generate a master.m3u8 for the live stream with multi-bitrate variants."""
    live_dir = os.path.join(settings.live_hls_path, stream_key)
    os.makedirs(live_dir, exist_ok=True)

    # Create quality subdirs (FFmpeg exec_push writes segments here)
    for quality in ("360p", "720p", "1080p"):
        os.makedirs(os.path.join(live_dir, quality), exist_ok=True)

    master = (
        "#EXTM3U\n"
        "#EXT-X-VERSION:7\n"
        "\n"
        '#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360,NAME="360p"\n'
        "360p/playlist.m3u8\n"
        "\n"
        '#EXT-X-STREAM-INF:BANDWIDTH=2928000,RESOLUTION=1280x720,NAME="720p"\n'
        "720p/playlist.m3u8\n"
        "\n"
        '#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,NAME="1080p"\n'
        "1080p/playlist.m3u8\n"
    )
    with open(os.path.join(live_dir, "master.m3u8"), "w") as f:
        f.write(master)


def _cleanup_live_segments(stream_key: str) -> None:
    """Remove HLS segments after stream ends."""
    live_dir = os.path.join(settings.live_hls_path, stream_key)
    if os.path.exists(live_dir):
        shutil.rmtree(live_dir, ignore_errors=True)


@router.post("/hooks/on_publish")
async def on_publish(
    name: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Called by nginx-rtmp when a broadcaster starts pushing to an RTMP URL.

    Validates the stream key exists and is in idle status.
    Returns 200 to allow, 403 to reject.
    """
    result = await db.execute(
        select(LiveStream).where(LiveStream.stream_key == name)
    )
    stream = result.scalar_one_or_none()

    if not stream:
        raise HTTPException(status_code=403, detail="Invalid stream key")

    if stream.status == "live":
        raise HTTPException(status_code=403, detail="Stream already active")

    # Generate master playlist for HLS
    _generate_master_playlist(name)

    stream.status = "live"
    stream.started_at = datetime.utcnow()
    stream.ended_at = None
    stream.viewer_count = 0
    stream.manifest_path = f"live/{name}/master.m3u8"

    return {"status": "ok"}


@router.post("/hooks/on_publish_done")
async def on_publish_done(
    name: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Called by nginx-rtmp when a broadcaster stops streaming.

    Marks the stream as ended and cleans up HLS segments.
    """
    result = await db.execute(
        select(LiveStream).where(LiveStream.stream_key == name)
    )
    stream = result.scalar_one_or_none()

    if stream and stream.status == "live":
        stream.status = "ended"
        stream.ended_at = datetime.utcnow()

    # Clean up segments (they're ephemeral for live)
    _cleanup_live_segments(name)

    return {"status": "ok"}
