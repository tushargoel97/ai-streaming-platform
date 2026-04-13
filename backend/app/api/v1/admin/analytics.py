import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import cast, Date, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.database import async_session, get_db
from app.models.analytics import ViewEvent, WatchHistory
from app.models.live import LiveStream
from app.models.transcode import TranscodeJob
from app.models.user import User
from app.models.video import Video

router = APIRouter(prefix="/admin/analytics", tags=["admin-analytics"])


@router.get("/overview")
async def analytics_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Dashboard overview — counts, storage, status breakdown, recent activity."""
    # Total counts
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_videos = (
        await db.execute(select(func.count(Video.id)).where(Video.status != "deleted"))
    ).scalar() or 0
    ready_videos = (
        await db.execute(select(func.count(Video.id)).where(Video.status == "ready"))
    ).scalar() or 0
    processing_videos = (
        await db.execute(select(func.count(Video.id)).where(Video.status == "processing"))
    ).scalar() or 0
    failed_videos = (
        await db.execute(select(func.count(Video.id)).where(Video.status == "failed"))
    ).scalar() or 0

    # Total views
    total_views = (
        await db.execute(
            select(func.coalesce(func.sum(Video.view_count), 0)).where(Video.status == "ready")
        )
    ).scalar() or 0

    # Storage (sum of file sizes)
    total_storage = (
        await db.execute(select(func.coalesce(func.sum(Video.file_size), 0)))
    ).scalar() or 0

    # Active live streams
    active_streams = (
        await db.execute(select(func.count(LiveStream.id)).where(LiveStream.status == "live"))
    ).scalar() or 0

    # Users by role
    role_counts_q = select(User.role, func.count(User.id)).group_by(User.role)
    role_result = await db.execute(role_counts_q)
    users_by_role = {role: count for role, count in role_result.all()}

    # Recent videos (last 5)
    recent_videos_q = (
        select(Video)
        .where(Video.status != "deleted")
        .order_by(Video.created_at.desc())
        .limit(5)
    )
    recent_videos = (await db.execute(recent_videos_q)).scalars().all()

    # Recent users (last 5)
    recent_users_q = select(User).order_by(User.created_at.desc()).limit(5)
    recent_users = (await db.execute(recent_users_q)).scalars().all()

    return {
        "total_users": total_users,
        "total_videos": total_videos,
        "total_views": total_views,
        "total_storage_bytes": total_storage,
        "active_streams": active_streams,
        "videos_by_status": {
            "ready": ready_videos,
            "processing": processing_videos,
            "failed": failed_videos,
        },
        "users_by_role": users_by_role,
        "recent_videos": [
            {
                "id": str(v.id),
                "title": v.title,
                "status": v.status,
                "view_count": v.view_count,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in recent_videos
        ],
        "recent_users": [
            {
                "id": str(u.id),
                "username": u.username,
                "email": u.email,
                "role": u.role,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in recent_users
        ],
    }


@router.get("/views")
async def view_trends(
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """View trends over time. Groups view events by day/week/month.

    Falls back to watch_history if no view_events exist (since view events
    are a newer addition to the platform).
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    # Try ViewEvent first (granular tracking)
    event_count = (
        await db.execute(
            select(func.count(ViewEvent.id)).where(ViewEvent.created_at >= cutoff)
        )
    ).scalar() or 0

    if event_count > 0:
        # Use ViewEvent table — group by date
        date_col = cast(ViewEvent.created_at, Date)
        stmt = (
            select(date_col.label("date"), func.count(ViewEvent.id).label("views"))
            .where(ViewEvent.created_at >= cutoff)
            .group_by(date_col)
            .order_by(date_col.asc())
        )
    else:
        # Fallback: use WatchHistory.last_watched_at
        date_col = cast(WatchHistory.last_watched_at, Date)
        stmt = (
            select(date_col.label("date"), func.count(WatchHistory.id).label("views"))
            .where(WatchHistory.last_watched_at >= cutoff)
            .group_by(date_col)
            .order_by(date_col.asc())
        )

    result = await db.execute(stmt)
    daily_data = [{"date": row.date.isoformat(), "views": row.views} for row in result.all()]

    # Aggregate into weeks/months if requested
    if period == "weekly":
        daily_data = _aggregate_weekly(daily_data)
    elif period == "monthly":
        daily_data = _aggregate_monthly(daily_data)

    return {"period": period, "days": days, "data": daily_data}


@router.get("/top-videos")
async def top_videos(
    limit: int = Query(20, ge=1, le=100),
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Top videos by view count (overall or within a time period via view events)."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    # Check if we have ViewEvent data
    event_count = (
        await db.execute(
            select(func.count(ViewEvent.id)).where(ViewEvent.created_at >= cutoff)
        )
    ).scalar() or 0

    if event_count > 0:
        # Use ViewEvent for time-scoped ranking
        stmt = (
            select(
                Video.id,
                Video.title,
                Video.thumbnail_path,
                Video.view_count,
                func.count(ViewEvent.id).label("recent_views"),
                func.coalesce(func.sum(ViewEvent.duration_watched), 0).label("total_watch_time"),
            )
            .join(ViewEvent, ViewEvent.video_id == Video.id)
            .where(ViewEvent.created_at >= cutoff, Video.status == "ready")
            .group_by(Video.id)
            .order_by(func.count(ViewEvent.id).desc())
            .limit(limit)
        )
        result = await db.execute(stmt)
        return [
            {
                "id": str(row.id),
                "title": row.title,
                "thumbnail_path": row.thumbnail_path,
                "view_count": row.view_count,
                "recent_views": row.recent_views,
                "total_watch_time": float(row.total_watch_time),
            }
            for row in result.all()
        ]
    else:
        # Fallback: use video.view_count (all-time)
        stmt = (
            select(Video)
            .where(Video.status == "ready")
            .order_by(Video.view_count.desc())
            .limit(limit)
        )
        result = await db.execute(stmt)
        return [
            {
                "id": str(v.id),
                "title": v.title,
                "thumbnail_path": v.thumbnail_path,
                "view_count": v.view_count,
                "recent_views": v.view_count,
                "total_watch_time": 0,
            }
            for v in result.scalars().all()
        ]


@router.get("/watch-activity")
async def watch_activity(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Recent watch activity — who watched what, when."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    stmt = (
        select(
            WatchHistory.last_watched_at,
            WatchHistory.progress,
            WatchHistory.completed,
            Video.id.label("video_id"),
            Video.title.label("video_title"),
            Video.duration.label("video_duration"),
            User.id.label("user_id"),
            User.username,
        )
        .join(Video, WatchHistory.video_id == Video.id)
        .join(User, WatchHistory.user_id == User.id)
        .where(WatchHistory.last_watched_at >= cutoff)
        .order_by(WatchHistory.last_watched_at.desc())
        .limit(50)
    )

    result = await db.execute(stmt)
    return [
        {
            "watched_at": row.last_watched_at.isoformat() if row.last_watched_at else None,
            "progress_seconds": row.progress,
            "completed": row.completed,
            "video_id": str(row.video_id),
            "video_title": row.video_title,
            "video_duration": row.video_duration,
            "user_id": str(row.user_id),
            "username": row.username,
        }
        for row in result.all()
    ]


# ── Helpers ──────────────────────────────────────────────────


def _aggregate_weekly(daily_data: list[dict]) -> list[dict]:
    """Aggregate daily data into ISO weeks."""
    from collections import defaultdict
    from datetime import date as date_type

    weeks: dict[str, int] = defaultdict(int)
    for entry in daily_data:
        d = date_type.fromisoformat(entry["date"])
        iso_year, iso_week, _ = d.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        weeks[week_key] += entry["views"]
    return [{"date": k, "views": v} for k, v in sorted(weeks.items())]


def _aggregate_monthly(daily_data: list[dict]) -> list[dict]:
    """Aggregate daily data into months."""
    from collections import defaultdict

    months: dict[str, int] = defaultdict(int)
    for entry in daily_data:
        month_key = entry["date"][:7]  # YYYY-MM
        months[month_key] += entry["views"]
    return [{"date": k, "views": v} for k, v in sorted(months.items())]


# ── SSE: Admin Dashboard Live Updates ────────────────────────────────────────


@router.get("/live")
async def dashboard_live_sse(
    user: User = Depends(require_admin),
):
    """SSE endpoint that pushes real-time dashboard metrics every 5 seconds.

    Emits JSON events with:
    - active_viewers: total viewers across all live streams
    - active_streams: number of live streams
    - processing_videos: number of videos being transcoded
    - total_views: cumulative view count
    - recent_view_events: views in the last hour
    """

    async def event_stream():
        while True:
            try:
                async with async_session() as db:
                    # Active streams and total viewers
                    stream_stats = await db.execute(
                        select(
                            func.count(LiveStream.id).label("count"),
                            func.coalesce(func.sum(LiveStream.viewer_count), 0).label("viewers"),
                        ).where(LiveStream.status == "live")
                    )
                    row = stream_stats.one()
                    active_streams = row.count
                    active_viewers = int(row.viewers)

                    # Processing videos (transcode queue)
                    processing = (
                        await db.execute(
                            select(func.count(TranscodeJob.id)).where(
                                TranscodeJob.status.in_(["queued", "processing"])
                            )
                        )
                    ).scalar() or 0

                    # Total views
                    total_views = (
                        await db.execute(
                            select(func.coalesce(func.sum(Video.view_count), 0)).where(
                                Video.status == "ready"
                            )
                        )
                    ).scalar() or 0

                    # Recent view events (last hour)
                    hour_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
                    recent_views = (
                        await db.execute(
                            select(func.count(ViewEvent.id)).where(
                                ViewEvent.created_at >= hour_ago
                            )
                        )
                    ).scalar() or 0

                payload = {
                    "active_viewers": active_viewers,
                    "active_streams": active_streams,
                    "processing_videos": processing,
                    "total_views": total_views,
                    "recent_view_events": recent_views,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                yield f"data: {json.dumps(payload)}\n\n"
            except Exception:
                yield f"data: {json.dumps({'error': 'fetch failed'})}\n\n"

            await asyncio.sleep(5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
