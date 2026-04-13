"""SSE endpoint for homepage feed updates.

Pushes notifications when new content is published (videos become ready,
new live streams start). Clients can use this to update the homepage
without polling.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.live import LiveStream
from app.models.video import Video

router = APIRouter(prefix="/feed", tags=["feed"])


@router.get("/updates")
async def feed_updates_sse(request: Request):
    """SSE endpoint that pushes homepage feed updates every 30 seconds.

    Emits JSON events with:
    - new_videos: count of videos published in the last 60 seconds
    - latest_video: most recently published video (id, title, thumbnail_path)
    - live_streams: count of currently live streams
    - live_stream_started: details if a stream went live in the last 60 seconds
    """

    async def event_stream():
        last_check = datetime.now(timezone.utc).replace(tzinfo=None)

        while True:
            try:
                now = datetime.now(timezone.utc).replace(tzinfo=None)
                since = last_check - timedelta(seconds=5)  # small overlap to avoid gaps

                async with async_session() as db:
                    # New videos since last check
                    new_videos_q = select(func.count(Video.id)).where(
                        Video.status == "ready",
                        Video.published_at >= since,
                    )
                    new_count = (await db.execute(new_videos_q)).scalar() or 0

                    # Latest published video
                    latest_q = (
                        select(Video)
                        .where(Video.status == "ready")
                        .order_by(Video.published_at.desc())
                        .limit(1)
                    )
                    latest_video = (await db.execute(latest_q)).scalar_one_or_none()

                    # Active live streams
                    live_count = (
                        await db.execute(
                            select(func.count(LiveStream.id)).where(LiveStream.status == "live")
                        )
                    ).scalar() or 0

                    # Streams that went live since last check
                    new_live_q = (
                        select(LiveStream)
                        .where(
                            LiveStream.status == "live",
                            LiveStream.started_at >= since,
                        )
                        .order_by(LiveStream.started_at.desc())
                        .limit(1)
                    )
                    new_stream = (await db.execute(new_live_q)).scalar_one_or_none()

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

                last_check = now
                yield f"data: {json.dumps(payload)}\n\n"

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
