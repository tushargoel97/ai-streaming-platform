import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.auth.permissions import get_current_user, optional_user
from app.database import get_db
from app.models.analytics import VideoReaction, ViewEvent, WatchHistory, Watchlist
from app.models.user import User
from app.models.video import Video
from app.schemas.video import VideoResponse
from app.schemas.watchlist import ReactionRequest, ReactionResponse, WatchlistResponse

router = APIRouter(tags=["watchlist"])

# ─── Watchlist ───────────────────────────────────────────────────────────────

WATCHLIST_PREFIX = "/watchlist"


@router.get(WATCHLIST_PREFIX, response_model=WatchlistResponse)
async def get_watchlist(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's watchlist."""
    query = select(Watchlist).where(Watchlist.user_id == user.id)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Watchlist.added_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    items = result.scalars().all()

    # Load all videos in one query with eagerly-loaded relationships
    video_ids = [item.video_id for item in items]
    if video_ids:
        video_result = await db.execute(
            select(Video)
            .where(Video.id.in_(video_ids), Video.status == "ready")
            .options(
                selectinload(Video.categories),
                selectinload(Video.tenant_videos),
                selectinload(Video.qualities),
                selectinload(Video.audio_tracks),
                selectinload(Video.subtitle_tracks),
            )
        )
        video_map = {v.id: v for v in video_result.scalars().all()}
    else:
        video_map = {}

    response_items = []
    for item in items:
        v = video_map.get(item.video_id)
        response_items.append({
            "id": item.id,
            "video_id": item.video_id,
            "added_at": item.added_at,
            "video": VideoResponse.from_video(v) if v else None,
        })

    return WatchlistResponse(items=response_items, total=total, page=page, page_size=page_size)


@router.post(f"{WATCHLIST_PREFIX}/{{video_id}}", status_code=status.HTTP_201_CREATED)
async def add_to_watchlist(
    video_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a video to the user's watchlist."""
    # Check video exists
    result = await db.execute(select(Video).where(Video.id == video_id, Video.status == "ready"))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Video not found")

    # Check not already in watchlist
    existing = await db.execute(
        select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.video_id == video_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Video already in watchlist")

    item = Watchlist(user_id=user.id, video_id=video_id)
    db.add(item)
    return {"message": "Added to watchlist"}


@router.delete(f"{WATCHLIST_PREFIX}/{{video_id}}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_watchlist(
    video_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a video from the user's watchlist."""
    result = await db.execute(
        select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.video_id == video_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Video not in watchlist")
    await db.delete(item)


@router.get(f"{WATCHLIST_PREFIX}/{{video_id}}/status")
async def check_watchlist_status(
    video_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if a video is in the user's watchlist."""
    result = await db.execute(
        select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.video_id == video_id)
    )
    return {"in_watchlist": result.scalar_one_or_none() is not None}


# ─── Reactions (Like / Dislike) ──────────────────────────────────────────────


@router.post("/videos/{video_id}/react", response_model=ReactionResponse)
async def react_to_video(
    video_id: uuid.UUID,
    body: ReactionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Like or dislike a video. Requires watching >= 70% of the video."""
    if body.reaction not in ("like", "dislike"):
        raise HTTPException(status_code=400, detail="Reaction must be 'like' or 'dislike'")

    # Check video exists
    video_result = await db.execute(select(Video).where(Video.id == video_id))
    video = video_result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Upsert reaction
    existing = await db.execute(
        select(VideoReaction).where(
            VideoReaction.user_id == user.id, VideoReaction.video_id == video_id
        )
    )
    reaction = existing.scalar_one_or_none()
    if reaction:
        reaction.reaction = body.reaction
    else:
        db.add(VideoReaction(user_id=user.id, video_id=video_id, reaction=body.reaction))

    await db.flush()
    return ReactionResponse(user_reaction=body.reaction)


@router.delete("/videos/{video_id}/react", status_code=status.HTTP_200_OK, response_model=ReactionResponse)
async def remove_reaction(
    video_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a reaction from a video."""
    result = await db.execute(
        select(VideoReaction).where(
            VideoReaction.user_id == user.id, VideoReaction.video_id == video_id
        )
    )
    reaction = result.scalar_one_or_none()
    if reaction:
        await db.delete(reaction)
        await db.flush()

    return ReactionResponse(user_reaction=None)


@router.get("/videos/{video_id}/reactions", response_model=ReactionResponse)
async def get_reactions(
    video_id: uuid.UUID,
    user: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's reaction for a video."""
    if not user:
        return ReactionResponse(user_reaction=None)

    result = await db.execute(
        select(VideoReaction.reaction).where(
            VideoReaction.user_id == user.id, VideoReaction.video_id == video_id
        )
    )
    row = result.scalar_one_or_none()
    return ReactionResponse(user_reaction=row)


# ─── Watch Progress ──────────────────────────────────────────────────────────


@router.post("/watchProgress/{video_id}")
async def save_watch_progress(
    video_id: uuid.UUID,
    body: dict,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save watch progress for a video. Body: {progress: float (seconds)}."""
    progress = body.get("progress", 0)
    if not isinstance(progress, (int, float)) or progress < 0:
        raise HTTPException(status_code=400, detail="Invalid progress value")

    # Verify video exists
    video_result = await db.execute(select(Video).where(Video.id == video_id))
    video = video_result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Cap progress at video duration
    if video.duration > 0:
        progress = min(progress, video.duration)

    pct = min(progress / video.duration, 1.0) if video.duration > 0 else 0
    completed = pct >= 0.95

    # Upsert watch history
    result = await db.execute(
        select(WatchHistory).where(
            WatchHistory.user_id == user.id,
            WatchHistory.video_id == video_id,
        )
    )
    history = result.scalar_one_or_none()
    if history:
        # Capture state before any mutations
        was_below = not history.completed

        # Detect new viewing session: if progress dropped significantly (< 10% of duration),
        # user is rewatching — reset progress and completed flag
        is_rewatch = progress < video.duration * 0.1 and history.progress > video.duration * 0.1
        if is_rewatch:
            history.completed = False
            was_below = True

        # Increment watch_count when crossing 70% threshold for the first time in this session
        now_above = pct >= 0.7
        if was_below and now_above:
            history.watch_count = (history.watch_count or 0) + 1

        history.progress = progress
        history.completed = completed or (was_below and now_above)
        history.last_watched_at = datetime.now(timezone.utc)
    else:
        first_watch_count = 1 if pct >= 0.7 else 0
        db.add(WatchHistory(
            user_id=user.id,
            video_id=video_id,
            progress=progress,
            completed=completed or pct >= 0.7,
            watch_count=first_watch_count,
        ))

    await db.flush()

    # Record a ViewEvent for analytics on first watch (progress > 5 seconds).
    # view_count increment is handled by the WebSocket player session to avoid double-counting.
    if not history and progress >= 5:
        db.add(ViewEvent(
            video_id=video_id,
            user_id=user.id,
            duration_watched=progress,
            ip_address=request.client.host if request.client else None,
            user_agent=(request.headers.get("user-agent") or "")[:500],
        ))

    watch_count = history.watch_count if history else (1 if pct >= 0.7 else 0)
    pct_display = min(round(pct * 100, 1), 100)
    return {"progress": progress, "duration": video.duration, "percentage": pct_display, "completed": completed, "watch_count": watch_count}


@router.get("/watchProgress")
async def get_watch_progress(
    video_ids: str = Query(..., description="Comma-separated video IDs"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get watch progress for multiple videos. Returns {video_id: {progress, duration, percentage}}."""
    ids = [v.strip() for v in video_ids.split(",") if v.strip()]
    if not ids or len(ids) > 100:
        return {}

    try:
        parsed_ids = [uuid.UUID(v) for v in ids]
    except ValueError:
        return {}

    # Fetch watch history for these videos
    result = await db.execute(
        select(WatchHistory).where(
            WatchHistory.user_id == user.id,
            WatchHistory.video_id.in_(parsed_ids),
        )
    )
    histories = {str(h.video_id): h for h in result.scalars().all()}

    # Fetch video durations
    video_result = await db.execute(
        select(Video.id, Video.duration).where(Video.id.in_(parsed_ids))
    )
    durations = {str(row.id): row.duration for row in video_result.all()}

    progress_map = {}
    for vid in ids:
        history = histories.get(vid)
        duration = durations.get(vid, 0)
        if history and duration and duration > 0:
            pct = min(round(history.progress / duration * 100, 1), 100)
            progress_map[vid] = {
                "progress": history.progress,
                "duration": duration,
                "percentage": pct,
                "watch_count": history.watch_count or 0,
            }

    return progress_map


@router.get("/watchProgress/series/{series_id}")
async def get_series_progress(
    series_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get overall watch progress for a series (across all episodes)."""
    # Get all episode IDs for this series
    episodes_result = await db.execute(
        select(Video.id, Video.duration).where(
            Video.series_id == series_id,
            Video.status == "ready",
        )
    )
    episodes = episodes_result.all()
    if not episodes:
        return {"percentage": 0, "watched_episodes": 0, "total_episodes": 0}

    episode_ids = [ep.id for ep in episodes]
    total_duration = sum(ep.duration or 0 for ep in episodes)

    # Get watch progress for all episodes
    history_result = await db.execute(
        select(WatchHistory).where(
            WatchHistory.user_id == user.id,
            WatchHistory.video_id.in_(episode_ids),
        )
    )
    histories = list(history_result.scalars().all())

    total_watched = sum(h.progress for h in histories)
    watched_episodes = sum(1 for h in histories if h.progress > 0)

    pct = min(round(total_watched / total_duration * 100, 1), 100) if total_duration > 0 else 0

    return {
        "percentage": pct,
        "watched_episodes": watched_episodes,
        "total_episodes": len(episodes),
    }
