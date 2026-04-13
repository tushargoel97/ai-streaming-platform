"""SSE endpoint for transcode progress + transcode management."""

import asyncio
import json
import uuid

from app.database import redis_pool
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.config import settings
from app.database import get_db
from app.models.transcode import TranscodeJob
from app.models.user import User

router = APIRouter(prefix="/admin/transcode", tags=["admin-transcode"])


@router.get("/{video_id}/status")
async def transcode_status_sse(
    video_id: uuid.UUID,
    user: User = Depends(require_admin),
):
    """SSE endpoint streaming transcode progress for a video.

    Emits JSON events with {percent, stage} until completion or failure.
    """

    async def event_stream():
        while True:
            data = await redis_pool.get(f"transcode:progress:{video_id}")
            if data:
                payload = json.loads(data)
                yield f"data: {json.dumps(payload)}\n\n"

                # Stop streaming when done or failed
                if payload.get("percent", 0) >= 100 or payload.get("stage") == "failed":
                    break
            else:
                yield f"data: {json.dumps({'percent': 0, 'stage': 'queued'})}\n\n"

            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/analyze/{video_id}/status")
async def analyze_status_sse(
    video_id: uuid.UUID,
    user: User = Depends(require_admin),
):
    """SSE endpoint streaming scene-analysis progress for a video."""

    async def event_stream():
        while True:
            data = await redis_pool.get(f"analyze:progress:{video_id}")
            if data:
                payload = json.loads(data)
                yield f"data: {json.dumps(payload)}\n\n"
                if payload.get("percent", 0) >= 100 or payload.get("stage") == "failed":
                    break
            else:
                yield f"data: {json.dumps({'percent': 0, 'stage': 'queued'})}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{video_id}/job")
async def get_transcode_job(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Get the latest transcode job for a video."""
    result = await db.execute(
        select(TranscodeJob)
        .where(TranscodeJob.video_id == video_id)
        .order_by(TranscodeJob.created_at.desc())
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if not job:
        return {"status": "none"}

    return {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "error_message": job.error_message,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
