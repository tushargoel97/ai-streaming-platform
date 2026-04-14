import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import optional_user
from app.database import get_db, redis_pool
from app.models.subscription import UserSubscription
from app.models.user import User
from app.models.video import Video, VideoCategory
from app.schemas.video import VideoListResponse, VideoResponse
from app.storage.urls import resolve_media_url

router = APIRouter(prefix="/videos", tags=["videos"])


async def _cache_get(key: str) -> str | None:
    try:
        return await redis_pool.get(key)
    except Exception:
        return None


async def _cache_set(key: str, value: str, ttl: int = 60) -> None:
    try:
        await redis_pool.set(key, value, ex=ttl)
    except Exception:
        pass


@router.get("", response_model=VideoListResponse)
async def list_videos(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category_id: uuid.UUID | None = None,
    search: str | None = None,
    sort: str = "recent",  # recent | views | title
    content_classification: str | None = None,
    min_duration: float | None = None,
    max_duration: float | None = None,
    quality: str | None = None,  # hd | 4k
    tag: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List publicly available videos (status=ready only)."""
    base = select(Video).where(Video.status == "ready")

    if category_id:
        base = base.where(
            Video.id.in_(
                select(VideoCategory.video_id).where(VideoCategory.category_id == category_id)
            )
        )

    if search:
        base = base.where(Video.title.ilike(f"%{search}%"))

    if content_classification:
        base = base.where(Video.content_classification == content_classification)

    if min_duration is not None:
        base = base.where(Video.duration >= min_duration)

    if max_duration is not None:
        base = base.where(Video.duration <= max_duration)

    if quality == "4k":
        base = base.where(Video.source_height >= 2160)
    elif quality == "hd":
        base = base.where(Video.source_height >= 720)

    if tag:
        base = base.where(Video.tags.any(tag))

    # Count (without eager loading)
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Sort + eager load
    query = base.options(
        selectinload(Video.qualities),
        selectinload(Video.audio_tracks),
        selectinload(Video.subtitle_tracks),
        selectinload(Video.categories),
    )
    if sort == "views":
        query = query.order_by(Video.view_count.desc())
    elif sort == "title":
        query = query.order_by(Video.title.asc())
    else:
        query = query.order_by(Video.published_at.desc().nullslast(), Video.created_at.desc())

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    videos = result.scalars().all()

    return VideoListResponse(items=videos, total=total, page=page, page_size=page_size)


@router.get("/genres", response_model=list[str])
async def list_genres(db: AsyncSession = Depends(get_db)):
    """Return all unique tags used across ready videos, sorted alphabetically."""
    cached = await _cache_get("videos:genres")
    if cached:
        return json.loads(cached)

    result = await db.execute(
        select(func.unnest(Video.tags))
        .where(Video.status == "ready")
        .where(Video.tags.isnot(None))
        .distinct()
    )
    tags = sorted([row[0] for row in result.all()])
    await _cache_set("videos:genres", json.dumps(tags), ttl=600)
    return tags


@router.get("/featured", response_model=list[VideoResponse])
async def get_featured_videos(
    db: AsyncSession = Depends(get_db),
):
    """Get featured videos for the hero section."""
    cached = await _cache_get("videos:featured")
    if cached:
        return json.loads(cached)

    result = await db.execute(
        select(Video)
        .options(
            selectinload(Video.qualities),
            selectinload(Video.audio_tracks),
            selectinload(Video.subtitle_tracks),
            selectinload(Video.categories),
        )
        .where(Video.status == "ready", Video.is_featured == True)
        .order_by(Video.updated_at.desc())
        .limit(10)
    )
    videos = result.scalars().all()
    serialized = [VideoResponse.model_validate(v).model_dump(mode="json") for v in videos]
    await _cache_set("videos:featured", json.dumps(serialized), ttl=120)
    return videos


@router.get("/trending", response_model=list[VideoResponse])
async def get_trending_videos(
    db: AsyncSession = Depends(get_db),
):
    """Get trending videos by view count."""
    cached = await _cache_get("videos:trending")
    if cached:
        return json.loads(cached)

    result = await db.execute(
        select(Video)
        .options(
            selectinload(Video.qualities),
            selectinload(Video.audio_tracks),
            selectinload(Video.subtitle_tracks),
            selectinload(Video.categories),
        )
        .where(Video.status == "ready")
        .order_by(Video.view_count.desc())
        .limit(20)
    )
    videos = result.scalars().all()
    serialized = [VideoResponse.model_validate(v).model_dump(mode="json") for v in videos]
    await _cache_set("videos:trending", json.dumps(serialized), ttl=60)
    return videos


@router.get("/{video_id}")
async def get_video(
    video_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    """Get a single video by ID (public), with relations eagerly loaded.

    If the video requires a subscription tier, manifest_url is stripped
    for users without sufficient access. An `access` object is included.
    """
    # Try cached video metadata
    cache_key = f"video:{video_id}"
    cached = await _cache_get(cache_key)
    if cached:
        data = json.loads(cached)
        video_min_tier = data.get("min_tier_level", 0)
    else:
        result = await db.execute(
            select(Video)
            .where(Video.id == video_id, Video.status == "ready")
            .options(
                selectinload(Video.qualities),
                selectinload(Video.audio_tracks),
                selectinload(Video.subtitle_tracks),
                selectinload(Video.categories),
            )
        )
        video = result.scalar_one_or_none()
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")

        response = VideoResponse.model_validate(video)
        data = response.model_dump(mode="json")
        video_min_tier = video.min_tier_level
        await _cache_set(cache_key, json.dumps(data), ttl=300)

    # Access check is always computed fresh (user-specific)

    # Build access info
    if video_min_tier == 0:
        data["access"] = {"has_access": True, "reason": "free"}
    elif user and user.role in ("admin", "superadmin"):
        data["access"] = {"has_access": True, "reason": "admin"}
    elif not user:
        data["access"] = {"has_access": False, "reason": "login_required", "min_tier_level": video_min_tier}
        data["manifest_url"] = ""
        data["manifest_path"] = None
    else:
        tenant = getattr(request.state, "tenant", None)
        tier_level = 0
        if tenant:
            sub_result = await db.execute(
                select(UserSubscription)
                .where(
                    UserSubscription.user_id == user.id,
                    UserSubscription.tenant_id == tenant.id,
                    UserSubscription.status == "active",
                )
                .options(selectinload(UserSubscription.tier))
            )
            sub = sub_result.scalar_one_or_none()
            if sub and sub.tier:
                tier_level = sub.tier.tier_level

        if tier_level >= video_min_tier:
            data["access"] = {"has_access": True, "reason": "subscribed"}
        else:
            data["access"] = {
                "has_access": False,
                "reason": "tier_too_low",
                "current_tier_level": tier_level,
                "min_tier_level": video_min_tier,
            }
            data["manifest_url"] = ""
            data["manifest_path"] = None

    return data


@router.get("/{video_id}/nextEpisode")
async def get_next_episode(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get adjacent episodes (previous/next) for series navigation."""
    # Get the current video
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.status == "ready")
    )
    video = result.scalar_one_or_none()
    if not video or not video.series_id or video.episode_number is None:
        return {"previous": None, "next": None}

    # Get previous episode (same series + season, episode_number - 1)
    prev_result = await db.execute(
        select(Video).where(
            Video.series_id == video.series_id,
            Video.season_id == video.season_id,
            Video.episode_number == video.episode_number - 1,
            Video.status == "ready",
        )
    )
    prev_ep = prev_result.scalar_one_or_none()

    # Get next episode (same series + season, episode_number + 1)
    next_result = await db.execute(
        select(Video).where(
            Video.series_id == video.series_id,
            Video.season_id == video.season_id,
            Video.episode_number == video.episode_number + 1,
            Video.status == "ready",
        )
    )
    next_ep = next_result.scalar_one_or_none()

    # If no next episode in current season, check first episode of next season
    if not next_ep and video.season_id:
        from app.models.series import Season
        current_season = await db.execute(
            select(Season).where(Season.id == video.season_id)
        )
        cs = current_season.scalar_one_or_none()
        if cs:
            next_season = await db.execute(
                select(Season).where(
                    Season.series_id == video.series_id,
                    Season.season_number == cs.season_number + 1,
                )
            )
            ns = next_season.scalar_one_or_none()
            if ns:
                next_result = await db.execute(
                    select(Video).where(
                        Video.series_id == video.series_id,
                        Video.season_id == ns.id,
                        Video.episode_number == 1,
                        Video.status == "ready",
                    )
                )
                next_ep = next_result.scalar_one_or_none()

    def episode_summary(ep: Video | None):
        if not ep:
            return None
        return {
            "id": str(ep.id),
            "title": ep.title,
            "episode_number": ep.episode_number,
            "thumbnail_path": ep.thumbnail_path,
            "thumbnail_url": resolve_media_url(ep.thumbnail_path),
            "duration": ep.duration,
        }

    return {"previous": episode_summary(prev_ep), "next": episode_summary(next_ep)}
