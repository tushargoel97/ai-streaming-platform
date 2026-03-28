import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.series import Season, Series
from app.models.video import Video
from app.schemas.series import SeriesDetailResponse, SeriesListResponse
from app.schemas.video import VideoResponse

router = APIRouter(prefix="/series", tags=["series"])


@router.get("", response_model=SeriesListResponse)
async def list_series(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List series (public)."""
    query = select(Series)
    if search:
        query = query.where(Series.title.ilike(f"%{search}%"))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Series.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    items = result.scalars().all()

    return SeriesListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{series_id}", response_model=SeriesDetailResponse)
async def get_series(
    series_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get series detail with seasons."""
    result = await db.execute(
        select(Series).where(Series.id == series_id).options(selectinload(Series.seasons))
    )
    series = result.scalar_one_or_none()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return series


@router.get("/{series_id}/seasons/{season_id}/episodes", response_model=list[VideoResponse])
async def get_season_episodes(
    series_id: uuid.UUID,
    season_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get all episodes in a season."""
    # Verify season exists
    result = await db.execute(
        select(Season).where(Season.id == season_id, Season.series_id == series_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Season not found")

    result = await db.execute(
        select(Video)
        .where(
            Video.series_id == series_id,
            Video.season_id == season_id,
            Video.status == "ready",
        )
        .order_by(Video.episode_number.asc())
    )
    return result.scalars().all()
