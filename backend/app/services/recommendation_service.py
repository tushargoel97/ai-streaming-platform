"""Recommendation service — content-based, collaborative filtering, and hybrid scoring."""

import logging
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.analytics import VideoReaction, WatchHistory
from app.models.recommendation import VideoEmbedding
from app.models.video import Video

logger = logging.getLogger(__name__)


async def get_similar_videos(
    video_id: uuid.UUID,
    db: AsyncSession,
    limit: int = 12,
) -> list[Video]:
    """Content-based: find videos with the most similar embeddings (cosine distance)."""
    # Get the source video's embedding
    emb_result = await db.execute(
        select(VideoEmbedding.embedding).where(VideoEmbedding.video_id == video_id)
    )
    source_embedding = emb_result.scalar_one_or_none()
    if source_embedding is None:
        return []

    # Get source video's series_id to exclude same-series episodes
    vid_result = await db.execute(
        select(Video.series_id).where(Video.id == video_id)
    )
    source_series_id = vid_result.scalar_one_or_none()

    # Query nearest neighbors via pgvector cosine distance (<=>)
    query = (
        select(Video)
        .join(VideoEmbedding, VideoEmbedding.video_id == Video.id)
        .where(
            Video.id != video_id,
            Video.status == "ready",
        )
        .order_by(VideoEmbedding.embedding.cosine_distance(source_embedding))
        .limit(limit)
    )

    # Exclude episodes from the same series
    if source_series_id:
        query = query.where(
            (Video.series_id != source_series_id) | (Video.series_id.is_(None))
        )

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_because_you_watched(
    user_id: uuid.UUID,
    db: AsyncSession,
    limit: int = 12,
) -> list[Video]:
    """Collaborative filtering: find videos watched by co-viewers but not by this user."""
    # CTE 1: user's recently watched videos
    user_videos = (
        select(WatchHistory.video_id)
        .where(WatchHistory.user_id == user_id)
        .order_by(WatchHistory.last_watched_at.desc())
        .limit(20)
        .cte("user_videos")
    )

    # CTE 2: co-viewers (other users who watched the same videos)
    co_viewers = (
        select(func.distinct(WatchHistory.user_id).label("user_id"))
        .join(user_videos, WatchHistory.video_id == user_videos.c.video_id)
        .where(WatchHistory.user_id != user_id)
        .cte("co_viewers")
    )

    # CTE 3: candidate videos from co-viewers, excluding user's already-watched
    candidates = (
        select(
            WatchHistory.video_id,
            func.count().label("score"),
        )
        .join(co_viewers, WatchHistory.user_id == co_viewers.c.user_id)
        .where(WatchHistory.video_id.notin_(select(user_videos.c.video_id)))
        .group_by(WatchHistory.video_id)
        .order_by(text("score DESC"))
        .limit(limit)
        .cte("candidates")
    )

    # Final: join with videos to get full objects
    query = (
        select(Video)
        .join(candidates, Video.id == candidates.c.video_id)
        .where(Video.status == "ready")
        .order_by(text("candidates.score DESC"))
    )

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_personalized_feed(
    user_id: uuid.UUID | None,
    db: AsyncSession,
    limit: int = 20,
) -> list[dict]:
    """Hybrid feed: returns sections of recommendations for the home page.

    Returns a list of sections like:
      [{"title": "Trending Now", "videos": [...]}, {"title": "Because You Watched", "videos": [...]}]
    """
    sections: list[dict] = []

    # 1. Featured videos (always shown)
    featured_result = await db.execute(
        select(Video)
        .where(Video.status == "ready", Video.is_featured == True)
        .order_by(Video.updated_at.desc())
        .limit(10)
    )
    featured = list(featured_result.scalars().all())
    if featured:
        sections.append({"title": "Featured", "videos": featured})

    # 2. Trending (view_count based — always shown)
    trending_result = await db.execute(
        select(Video)
        .where(Video.status == "ready")
        .order_by(Video.view_count.desc())
        .limit(limit)
    )
    trending = list(trending_result.scalars().all())
    if trending:
        sections.append({"title": "Trending Now", "videos": trending})

    # 3. Recently added
    recent_result = await db.execute(
        select(Video)
        .where(Video.status == "ready")
        .order_by(Video.published_at.desc().nullslast(), Video.created_at.desc())
        .limit(limit)
    )
    recent = list(recent_result.scalars().all())
    if recent:
        sections.append({"title": "Recently Added", "videos": recent})

    if not user_id:
        return sections

    # 4. "Continue Watching" — in-progress videos (> 0% and < 50%)
    continue_result = await db.execute(
        select(Video)
        .join(WatchHistory, WatchHistory.video_id == Video.id)
        .where(
            WatchHistory.user_id == user_id,
            WatchHistory.progress > 0,
            Video.status == "ready",
            Video.duration > 0,
        )
        .where(
            (WatchHistory.progress / Video.duration) < 0.5,
        )
        .order_by(WatchHistory.last_watched_at.desc())
        .limit(limit)
    )
    continue_watching = list(continue_result.scalars().all())
    if continue_watching:
        sections.insert(0, {"title": "Continue Watching", "videos": continue_watching})

    # 5. "Because You Watched" (collaborative, authenticated only)
    collaborative = await get_because_you_watched(user_id, db, limit=limit)
    if collaborative:
        sections.append({"title": "Because You Watched", "videos": collaborative})

    # 6. Personalized via embedding — average of liked/watched video embeddings
    personalized = await _get_embedding_personalized(user_id, db, limit=limit)
    if personalized:
        sections.append({"title": "Recommended For You", "videos": personalized})

    return sections


async def _get_embedding_personalized(
    user_id: uuid.UUID,
    db: AsyncSession,
    limit: int = 12,
) -> list[Video]:
    """Content-based personalization: compute a user profile vector from liked/watched videos,
    then find nearest unwatched videos."""
    # Get embeddings of videos the user liked or recently completed
    liked_ids = await db.execute(
        select(VideoReaction.video_id).where(
            VideoReaction.user_id == user_id,
            VideoReaction.reaction == "like",
        )
    )
    liked_video_ids = [r for r in liked_ids.scalars().all()]

    completed_ids = await db.execute(
        select(WatchHistory.video_id).where(
            WatchHistory.user_id == user_id,
            WatchHistory.completed == True,
        ).order_by(WatchHistory.last_watched_at.desc()).limit(10)
    )
    completed_video_ids = [r for r in completed_ids.scalars().all()]

    # Merge and deduplicate
    profile_ids = list(set(liked_video_ids + completed_video_ids))
    if not profile_ids:
        return []

    # Compute average embedding (user profile vector)
    avg_result = await db.execute(
        select(func.avg(VideoEmbedding.embedding))
        .where(VideoEmbedding.video_id.in_(profile_ids))
    )
    avg_embedding = avg_result.scalar_one_or_none()
    if avg_embedding is None:
        return []

    # Get all user's watched video IDs to exclude
    watched_result = await db.execute(
        select(WatchHistory.video_id).where(WatchHistory.user_id == user_id)
    )
    watched_ids = set(watched_result.scalars().all())

    # Find nearest videos to the profile vector, excluding already watched
    query = (
        select(Video)
        .join(VideoEmbedding, VideoEmbedding.video_id == Video.id)
        .where(Video.status == "ready")
    )
    if watched_ids:
        query = query.where(Video.id.notin_(watched_ids))

    query = (
        query
        .order_by(VideoEmbedding.embedding.cosine_distance(avg_embedding))
        .limit(limit)
    )

    result = await db.execute(query)
    return list(result.scalars().all())
