import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import require_admin
from app.database import get_db
from app.models.series import Season, Series
from app.models.user import User
from app.models.video import Video
from app.schemas.series import (
    EpisodeAssignRequest,
    SeasonCreateRequest,
    SeasonResponse,
    SeasonUpdateRequest,
    SeriesCreateRequest,
    SeriesDetailResponse,
    SeriesListResponse,
    SeriesUpdateRequest,
)
from app.schemas.video import VideoResponse

router = APIRouter(prefix="/admin/series", tags=["admin-series"])


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text


@router.post("", response_model=SeriesDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_series(
    body: SeriesCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    if body.content_classification not in ("safe", "mature", "explicit"):
        raise HTTPException(status_code=400, detail="Invalid content_classification")

    base_slug = _slugify(body.title)
    existing = await db.execute(select(Series).where(Series.slug == base_slug))
    if existing.scalar_one_or_none():
        base_slug = f"{base_slug}-{uuid.uuid4().hex[:6]}"

    series = Series(
        title=body.title,
        slug=base_slug,
        description=body.description,
        poster_url=body.poster_url,
        banner_url=body.banner_url,
        content_classification=body.content_classification,
        status=body.status,
        year_started=body.year_started,
        tags=body.tags,
    )
    db.add(series)
    await db.flush()

    # Reload with seasons
    result = await db.execute(
        select(Series).where(Series.id == series.id).options(selectinload(Series.seasons))
    )
    return result.scalar_one()


@router.get("", response_model=SeriesListResponse)
async def list_series(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    query = select(Series)
    if search:
        query = query.where(Series.title.ilike(f"%{search}%"))
    if status_filter:
        query = query.where(Series.status == status_filter)

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
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Series).where(Series.id == series_id).options(selectinload(Series.seasons))
    )
    series = result.scalar_one_or_none()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return series


@router.patch("/{series_id}", response_model=SeriesDetailResponse)
async def update_series(
    series_id: uuid.UUID,
    body: SeriesUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Series).where(Series.id == series_id).options(selectinload(Series.seasons))
    )
    series = result.scalar_one_or_none()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    update_data = body.model_dump(exclude_unset=True)
    if "content_classification" in update_data and update_data["content_classification"] not in (
        "safe", "mature", "explicit"
    ):
        raise HTTPException(status_code=400, detail="Invalid content_classification")

    for field, value in update_data.items():
        setattr(series, field, value)

    series.updated_at = datetime.utcnow()
    return series


@router.delete("/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series(
    series_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Series).where(Series.id == series_id))
    series = result.scalar_one_or_none()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    await db.delete(series)


# --- Seasons ---

@router.post("/{series_id}/seasons", response_model=SeasonResponse, status_code=status.HTTP_201_CREATED)
async def add_season(
    series_id: uuid.UUID,
    body: SeasonCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Series).where(Series.id == series_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Series not found")

    # Check duplicate season number
    existing = await db.execute(
        select(Season).where(Season.series_id == series_id, Season.season_number == body.season_number)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Season {body.season_number} already exists")

    season = Season(
        series_id=series_id,
        season_number=body.season_number,
        title=body.title,
        description=body.description,
        poster_url=body.poster_url,
    )
    db.add(season)
    await db.flush()
    return season


@router.patch("/{series_id}/seasons/{season_id}", response_model=SeasonResponse)
async def update_season(
    series_id: uuid.UUID,
    season_id: uuid.UUID,
    body: SeasonUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Season).where(Season.id == season_id, Season.series_id == series_id)
    )
    season = result.scalar_one_or_none()
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(season, field, value)
    return season


@router.delete("/{series_id}/seasons/{season_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_season(
    series_id: uuid.UUID,
    season_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Season).where(Season.id == season_id, Season.series_id == series_id)
    )
    season = result.scalar_one_or_none()
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    await db.delete(season)


# --- Episode assignment ---

@router.patch("/videos/{video_id}/episode", response_model=VideoResponse)
async def assign_episode(
    video_id: uuid.UUID,
    body: EpisodeAssignRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Assign a video as an episode of a series/season."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Verify series and season exist
    result = await db.execute(select(Series).where(Series.id == body.series_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Series not found")

    result = await db.execute(
        select(Season).where(Season.id == body.season_id, Season.series_id == body.series_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Season not found")

    video.series_id = body.series_id
    video.season_id = body.season_id
    video.episode_number = body.episode_number
    video.updated_at = datetime.utcnow()
    return video
