"""Admin live stream management API.

Endpoints:
  GET    /admin/live/streams              — list all streams (any status)
  POST   /admin/live/streams              — create stream key
  GET    /admin/live/streams/{id}         — stream detail (inc. stream key)
  PATCH  /admin/live/streams/{id}         — update title/description
  DELETE /admin/live/streams/{id}         — end & delete stream
"""

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.live import _cleanup_live_segments
from app.auth.permissions import require_admin
from app.database import get_db
from app.models.live import LiveStream
from app.models.user import User
from app.schemas.live import (
    LiveStreamAdmin,
    LiveStreamCreate,
    LiveStreamCreated,
    LiveStreamUpdate,
)

router = APIRouter(prefix="/admin/live", tags=["admin-live"])


def _generate_stream_key() -> str:
    """Generate a unique, URL-safe stream key."""
    return f"live_{secrets.token_urlsafe(24)}"


def _build_admin(stream: LiveStream) -> dict:
    """Serialize a LiveStream for admin response."""
    manifest_url = ""
    if stream.status == "live" and stream.stream_key:
        manifest_url = f"/live/{stream.stream_key}/master.m3u8"
    return {
        "id": stream.id,
        "title": stream.title,
        "description": stream.description,
        "status": stream.status,
        "category_id": stream.category_id,
        "category_name": stream.category.name if stream.category else "",
        "stream_key": stream.stream_key,
        "manifest_url": manifest_url,
        "thumbnail_url": "",
        "viewer_count": stream.viewer_count,
        "peak_viewers": stream.peak_viewers,
        "tenant_id": stream.tenant_id,
        "is_ppv": stream.is_ppv,
        "ppv_price": str(stream.ppv_price) if stream.ppv_price is not None else None,
        "ppv_currency": stream.ppv_currency,
        "created_by": stream.created_by,
        "started_at": stream.started_at,
        "ended_at": stream.ended_at,
        "created_at": stream.created_at,
        "updated_at": stream.updated_at,
    }


@router.get("/streams", response_model=list[LiveStreamAdmin])
async def list_streams(
    request: Request,
    status_filter: str | None = Query(None, alias="status"),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all live streams. Optionally filter by status (idle/live/ended)."""
    tenant = getattr(request.state, "tenant", None)
    query = select(LiveStream).options(selectinload(LiveStream.category))
    if tenant:
        query = query.where(LiveStream.tenant_id == tenant.id)
    if status_filter:
        query = query.where(LiveStream.status == status_filter)
    query = query.order_by(LiveStream.created_at.desc())
    result = await db.execute(query)
    streams = result.scalars().all()
    return [_build_admin(s) for s in streams]


@router.post("/streams", response_model=LiveStreamCreated, status_code=status.HTTP_201_CREATED)
async def create_stream(
    body: LiveStreamCreate,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new live stream with a generated stream key."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="No tenant context")

    stream_key = _generate_stream_key()
    stream = LiveStream(
        title=body.title,
        description=body.description,
        category_id=body.category_id,
        is_ppv=body.is_ppv,
        ppv_price=body.ppv_price,
        ppv_currency=body.ppv_currency,
        stream_key=stream_key,
        tenant_id=tenant.id,
        created_by=admin.id,
        status="idle",
    )
    db.add(stream)
    await db.flush()

    return LiveStreamCreated(
        id=stream.id,
        title=stream.title,
        stream_key=stream_key,
        rtmp_url=f"rtmp://localhost:1935/live/{stream_key}",
        status="idle",
    )


@router.get("/streams/{stream_id}", response_model=LiveStreamAdmin)
async def get_stream(
    stream_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get full details of a stream, including stream key."""
    result = await db.execute(select(LiveStream).options(selectinload(LiveStream.category)).where(LiveStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    return _build_admin(stream)


@router.patch("/streams/{stream_id}", response_model=LiveStreamAdmin)
async def update_stream(
    stream_id: uuid.UUID,
    body: LiveStreamUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update stream title/description/category."""
    result = await db.execute(select(LiveStream).options(selectinload(LiveStream.category)).where(LiveStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    if body.title is not None:
        stream.title = body.title
    if body.description is not None:
        stream.description = body.description
    if body.category_id is not None:
        stream.category_id = body.category_id
    if body.is_ppv is not None:
        stream.is_ppv = body.is_ppv
    if body.ppv_price is not None:
        stream.ppv_price = body.ppv_price
    if body.ppv_currency is not None:
        stream.ppv_currency = body.ppv_currency

    await db.flush()
    await db.refresh(stream, ["category"])
    return _build_admin(stream)


@router.delete("/streams/{stream_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stream(
    stream_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """End and delete a live stream. Cleans up HLS segments if active."""
    result = await db.execute(select(LiveStream).where(LiveStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    # Clean up any HLS segments on disk
    _cleanup_live_segments(stream.stream_key)

    await db.delete(stream)


@router.post("/streams/{stream_id}/end", response_model=LiveStreamAdmin)
async def end_stream(
    stream_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manually end a live stream (resets to idle for reuse)."""
    result = await db.execute(select(LiveStream).options(selectinload(LiveStream.category)).where(LiveStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    if stream.status != "live":
        raise HTTPException(status_code=400, detail="Stream is not live")

    _cleanup_live_segments(stream.stream_key)
    stream.status = "idle"
    stream.viewer_count = 0
    await db.flush()
    return _build_admin(stream)


@router.post("/streams/{stream_id}/reset", response_model=LiveStreamAdmin)
async def reset_stream(
    stream_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reset an ended stream back to idle so it can go live again."""
    result = await db.execute(select(LiveStream).options(selectinload(LiveStream.category)).where(LiveStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")

    if stream.status == "live":
        raise HTTPException(status_code=400, detail="Stream is currently live")

    stream.status = "idle"
    stream.viewer_count = 0
    stream.peak_viewers = 0
    stream.started_at = None
    stream.ended_at = None
    await db.flush()
    return _build_admin(stream)
