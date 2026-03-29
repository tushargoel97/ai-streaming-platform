"""Celery task definitions for long-running background jobs."""

import asyncio
import uuid

from app.worker.celery_app import celery


@celery.task(name="transcode_video", bind=True, max_retries=0)
def transcode_video(self, video_id: str) -> None:
    """Run the full transcode pipeline for a video."""
    from app.services.transcode_service import _transcode_pipeline

    asyncio.run(_transcode_pipeline(uuid.UUID(video_id)))


@celery.task(name="analyze_scene", bind=True, max_retries=0)
def analyze_scene(self, video_id: str) -> None:
    """Run AI scene analysis to pick an optimal preview timestamp."""

    async def _run() -> None:
        from app.database import async_session
        from app.services.scene_analysis import run_scene_analysis

        async with async_session() as db:
            await run_scene_analysis(uuid.UUID(video_id), db)

    asyncio.run(_run())
