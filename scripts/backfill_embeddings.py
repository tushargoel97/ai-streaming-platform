"""Backfill embeddings for all videos that don't have one yet.

Usage:
    docker compose exec backend python -m scripts.backfill_embeddings
"""

import asyncio
import logging
import sys

from sqlalchemy import select

# Ensure the app package is importable
sys.path.insert(0, "/app")

from app.database import async_session
from app.models.recommendation import VideoEmbedding
from app.models.video import Video
from app.services.embedding_service import build_embedding_text, get_embeddings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

BATCH_SIZE = 32


async def main():
    async with async_session() as db:
        # Find videos with status='ready' that have no embedding
        result = await db.execute(
            select(Video)
            .where(
                Video.status == "ready",
                ~Video.id.in_(select(VideoEmbedding.video_id)),
            )
            .order_by(Video.created_at.asc())
        )
        videos = list(result.scalars().all())

        if not videos:
            logger.info("All videos already have embeddings. Nothing to do.")
            return

        logger.info("Found %d videos without embeddings", len(videos))

        # Process in batches
        for i in range(0, len(videos), BATCH_SIZE):
            batch = videos[i : i + BATCH_SIZE]
            texts = [build_embedding_text(v) for v in batch]
            embeddings = await get_embeddings(texts)

            for video, embedding in zip(batch, embeddings):
                db.add(VideoEmbedding(
                    video_id=video.id,
                    embedding=embedding,
                    model_version="all-MiniLM-L6-v2",
                ))

            await db.commit()
            logger.info("Processed %d/%d videos", min(i + BATCH_SIZE, len(videos)), len(videos))

    logger.info("Backfill complete.")


if __name__ == "__main__":
    asyncio.run(main())
