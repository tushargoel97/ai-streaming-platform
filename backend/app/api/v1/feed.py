"""SSE endpoint for homepage feed updates.

Pushes notifications when new content is published (videos become ready,
new live streams start). Clients can use this to update the homepage
without polling.

Feed data is cached in Redis (refreshed every 30s by the first client),
so all connected SSE clients read from cache instead of each querying the DB.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func

from app.database import async_session, redis_pool
from app.models.live import LiveStream
from app.models.video import Video

router = APIRouter(prefix="/feed", tags=["feed"])

_FEED_CACHE_KEY = "feed:updates"
_FEED_CACHE_TTL = 25  # slightly less than SSE interval to stay fresh


async def _refresh_feed_cache() -> str:
    """Query DB for feed data and cache in Redis. Returns JSON string."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(seconds=60)

    async with async_session() as db:
        new_count = (
            await db.execute(
                select(func.count(Video.id)).where(
                    Video.status == "ready",
                    Video.published_at >= since,
                )
            )
        ).scalar() or 0

        latest_video = (
            await db.execute(
                select(Video)
                .where(Video.status == "ready")
                .order_by(Video.published_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        live_count = (
            await db.execute(
                select(func.count(LiveStream.id)).where(LiveStream.status == "live")
            )
        ).scalar() or 0

        new_stream = (
            await db.execute(
                select(LiveStream)
                .where(LiveStream.status == "live", LiveStream.started_at >= since)
                .order_by(LiveStream.started_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    payload: dict = {
        "new_videos": new_count,
        "live_streams": live_count,
        "timestamp": now.isoformat(),
    }
    if latest_video:
        payload["latest_video"] = {
            "id": str(latest_video.id),
            "title": latest_video.title,
            "thumbnail_path": latest_video.thumbnail_path,
        }
    if new_stream:
        payload["live_stream_started"] = {
            "id": str(new_stream.id),
            "title": new_stream.title,
            "started_at": new_stream.started_at.isoformat() if new_stream.started_at else None,
        }

    data = json.dumps(payload)
    try:
        await redis_pool.set(_FEED_CACHE_KEY, data, ex=_FEED_CACHE_TTL)
    except Exception:
        pass
    return data


@router.get("/updates")
async def feed_updates_sse(request: Request):
    """SSE endpoint that pushes homepage feed updates every 30 seconds.

    All clients share a single Redis-cached feed snapshot, avoiding
    per-client DB queries.
    """

    async def event_stream():
        while True:
            try:
                # Read from cache; refresh if stale/missing
                cached = None
                try:
                    cached = await redis_pool.get(_FEED_CACHE_KEY)
                except Exception:
                    pass

                if cached:
                    data = cached
                else:
                    data = await _refresh_feed_cache()

                yield f"data: {data}\n\n"
            except Exception:
                yield f"data: {json.dumps({'error': 'fetch failed'})}\n\n"

            await asyncio.sleep(30)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
