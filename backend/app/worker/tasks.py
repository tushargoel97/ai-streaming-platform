"""Celery task definitions for long-running background jobs."""

import asyncio
import uuid

from app.worker.celery_app import celery


def _reset_db_pool() -> None:
    """Dispose the SQLAlchemy async engine pool before each task.

    Celery prefork workers run each task in the same process but with a new
    event loop (via asyncio.run). Pooled asyncpg connections are attached to
    the previous loop and cause "Future attached to a different loop" errors.
    Disposing the sync engine resets the pool so fresh connections are created
    in the new loop.
    """
    from app.database import engine
    engine.sync_engine.dispose()


@celery.task(name="transcode_video", bind=True, max_retries=0)
def transcode_video(self, video_id: str) -> None:
    """Run the full transcode pipeline for a video."""
    from app.services.transcode_service import _transcode_pipeline

    _reset_db_pool()
    asyncio.run(_transcode_pipeline(uuid.UUID(video_id)))


@celery.task(name="analyze_scene", bind=True, max_retries=0)
def analyze_scene(self, video_id: str) -> None:
    """Run AI scene analysis to pick an optimal preview timestamp."""

    async def _run() -> None:
        from app.database import async_session
        from app.services.scene_analysis import run_scene_analysis

        async with async_session() as db:
            await run_scene_analysis(uuid.UUID(video_id), db)

    _reset_db_pool()
    asyncio.run(_run())
