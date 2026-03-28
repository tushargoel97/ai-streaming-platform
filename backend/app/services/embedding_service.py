"""Embedding service — proxies to the AI microservice for vector generation.

The AI service owns the sentence-transformers model. This module provides the same
async interface the rest of the backend expects, but calls the AI service via HTTP.
"""

import logging
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.recommendation import VideoEmbedding
from app.models.video import Video

logger = logging.getLogger(__name__)


def _ai_url(path: str) -> str:
    return f"{settings.ai_service_url}{path}"


def build_embedding_text(video: Video) -> str:
    """Build the text string to embed from video metadata."""
    parts = [video.title]
    if video.description:
        parts.append(video.description)
    if video.tags:
        parts.append(" ".join(video.tags))
    return ". ".join(parts)


async def get_embedding(text: str) -> list[float]:
    """Generate embedding for a single text via the AI service."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(_ai_url("/embeddings/single"), json={"text": text})
        resp.raise_for_status()
        return resp.json()["embedding"]


async def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts via the AI service."""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(_ai_url("/embeddings/generate"), json={"texts": texts})
        resp.raise_for_status()
        return resp.json()["embeddings"]


async def generate_and_store_embedding(video_id: uuid.UUID, db: AsyncSession) -> None:
    """Generate an embedding for a video and upsert it into video_embeddings."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        logger.warning("Cannot generate embedding: video %s not found", video_id)
        return

    text = build_embedding_text(video)
    if not text.strip():
        logger.warning("Empty embedding text for video %s, skipping", video_id)
        return

    embedding = await get_embedding(text)

    # Upsert
    result = await db.execute(
        select(VideoEmbedding).where(VideoEmbedding.video_id == video_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.embedding = embedding
        existing.model_version = "ai-service"
    else:
        db.add(VideoEmbedding(
            video_id=video_id,
            embedding=embedding,
            model_version="ai-service",
        ))

    await db.flush()
    logger.info("Embedding stored for video %s", video_id)
