"""Recommendation API — content-based similarity, collaborative, and personalized feed."""

import json
import logging
import uuid

from app.database import redis_pool
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import optional_user
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.recommendation import (
    PersonalizedFeedResponse,
    RecommendationSection,
    VideoSummary,
)
from app.services import recommendation_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


async def _get_cached(key: str) -> str | None:
    return await redis_pool.get(key)


async def _set_cached(key: str, value: str, ttl: int | None = None) -> None:
    await redis_pool.set(key, value, ex=ttl or settings.recommendation_cache_ttl)


def _serialize_videos(videos) -> str:
    return json.dumps([VideoSummary.model_validate(v).model_dump(mode="json") for v in videos])


@router.get("/similar/{video_id}", response_model=list[VideoSummary])
async def get_similar(
    video_id: uuid.UUID,
    limit: int = Query(12, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Get content-similar videos ("More Like This") using vector similarity."""
    cache_key = f"reco:similar:{video_id}:{limit}"
    cached = await _get_cached(cache_key)
    if cached:
        return json.loads(cached)

    videos = await recommendation_service.get_similar_videos(video_id, db, limit=limit)
    serialized = _serialize_videos(videos)
    await _set_cached(cache_key, serialized)
    return json.loads(serialized)


@router.get("/personal", response_model=PersonalizedFeedResponse)
async def get_personal_feed(
    limit: int = Query(20, ge=1, le=50),
    user: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Get personalized recommendation feed (sections). Falls back to trending for anonymous."""
    user_id = user.id if user else None
    cache_key = f"reco:personal:{user_id or 'anon'}:{limit}"
    cached = await _get_cached(cache_key)
    if cached:
        return json.loads(cached)

    sections_data = await recommendation_service.get_personalized_feed(user_id, db, limit=limit)

    # Convert to response model (VideoSummary avoids lazy-loaded relations)
    sections = []
    for section in sections_data:
        video_summaries = [VideoSummary.model_validate(v) for v in section["videos"]]
        sections.append(RecommendationSection(title=section["title"], videos=video_summaries))

    response = PersonalizedFeedResponse(sections=sections)
    serialized = response.model_dump_json()
    await _set_cached(cache_key, serialized)
    return response


@router.get("/becauseYouWatched", response_model=list[VideoSummary])
async def get_collaborative(
    limit: int = Query(12, ge=1, le=50),
    user: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Get collaborative filtering recommendations ("Because You Watched")."""
    if not user:
        return []

    cache_key = f"reco:byw:{user.id}:{limit}"
    cached = await _get_cached(cache_key)
    if cached:
        return json.loads(cached)

    videos = await recommendation_service.get_because_you_watched(user.id, db, limit=limit)
    serialized = _serialize_videos(videos)
    await _set_cached(cache_key, serialized)
    return json.loads(serialized)
