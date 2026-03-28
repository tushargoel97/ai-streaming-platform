import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.talent import Talent
from app.models.video import Video, VideoTalent
from app.schemas.talent import TalentDetailResponse, TalentListResponse
from app.schemas.video import VideoResponse

router = APIRouter(prefix="/talents", tags=["talents"])


@router.get("", response_model=TalentListResponse)
async def list_talents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List talents (public)."""
    query = select(Talent)
    if search:
        query = query.where(Talent.name.ilike(f"%{search}%"))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Talent.name.asc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    talents = result.scalars().all()

    return TalentListResponse(items=talents, total=total, page=page, page_size=page_size)


@router.get("/{talent_id}", response_model=TalentDetailResponse)
async def get_talent(
    talent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get talent detail with video count."""
    result = await db.execute(select(Talent).where(Talent.id == talent_id))
    talent = result.scalar_one_or_none()
    if not talent:
        raise HTTPException(status_code=404, detail="Talent not found")

    # Get video count
    count_q = select(func.count()).select_from(
        select(VideoTalent).where(VideoTalent.talent_id == talent_id).subquery()
    )
    video_count = (await db.execute(count_q)).scalar() or 0

    return TalentDetailResponse(
        **{c.key: getattr(talent, c.key) for c in Talent.__table__.columns},
        video_count=video_count,
    )


@router.get("/{talent_id}/videos", response_model=list[VideoResponse])
async def get_talent_videos(
    talent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get all videos featuring this talent."""
    result = await db.execute(
        select(Video)
        .join(VideoTalent, VideoTalent.video_id == Video.id)
        .where(VideoTalent.talent_id == talent_id, Video.status == "ready")
        .order_by(Video.published_at.desc().nullslast())
    )
    return result.scalars().all()
