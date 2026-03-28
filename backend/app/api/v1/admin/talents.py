import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.database import get_db
from app.models.talent import Talent
from app.models.user import User
from app.models.video import VideoTalent
from app.schemas.talent import (
    TalentCreateRequest,
    TalentListResponse,
    TalentResponse,
    TalentUpdateRequest,
    VideoTalentRequest,
)

router = APIRouter(prefix="/admin/talents", tags=["admin-talents"])


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text


@router.post("", response_model=TalentResponse, status_code=status.HTTP_201_CREATED)
async def create_talent(
    body: TalentCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    base_slug = _slugify(body.name)
    # Check slug uniqueness
    existing = await db.execute(select(Talent).where(Talent.slug == base_slug))
    if existing.scalar_one_or_none():
        base_slug = f"{base_slug}-{uuid.uuid4().hex[:6]}"

    talent = Talent(
        name=body.name,
        slug=base_slug,
        bio=body.bio,
        photo_url=body.photo_url,
        birth_date=body.birth_date,
    )
    db.add(talent)
    await db.flush()
    return talent


@router.get("", response_model=TalentListResponse)
async def list_talents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
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


@router.get("/{talent_id}", response_model=TalentResponse)
async def get_talent(
    talent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Talent).where(Talent.id == talent_id))
    talent = result.scalar_one_or_none()
    if not talent:
        raise HTTPException(status_code=404, detail="Talent not found")
    return talent


@router.patch("/{talent_id}", response_model=TalentResponse)
async def update_talent(
    talent_id: uuid.UUID,
    body: TalentUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Talent).where(Talent.id == talent_id))
    talent = result.scalar_one_or_none()
    if not talent:
        raise HTTPException(status_code=404, detail="Talent not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(talent, field, value)

    if "name" in update_data:
        talent.slug = _slugify(update_data["name"])

    talent.updated_at = datetime.utcnow()
    return talent


@router.delete("/{talent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_talent(
    talent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Talent).where(Talent.id == talent_id))
    talent = result.scalar_one_or_none()
    if not talent:
        raise HTTPException(status_code=404, detail="Talent not found")
    await db.delete(talent)


@router.post("/videos/{video_id}/talents/{talent_id}", status_code=status.HTTP_201_CREATED)
async def link_talent_to_video(
    video_id: uuid.UUID,
    talent_id: uuid.UUID,
    body: VideoTalentRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Link a talent to a video."""
    existing = await db.execute(
        select(VideoTalent).where(
            VideoTalent.video_id == video_id, VideoTalent.talent_id == talent_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Talent already linked to this video")

    link = VideoTalent(
        video_id=video_id,
        talent_id=talent_id,
        role=body.role if body else "",
        sort_order=body.sort_order if body else 0,
    )
    db.add(link)
    return {"message": "Talent linked to video"}


@router.delete("/videos/{video_id}/talents/{talent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_talent_from_video(
    video_id: uuid.UUID,
    talent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Unlink a talent from a video."""
    result = await db.execute(
        select(VideoTalent).where(
            VideoTalent.video_id == video_id, VideoTalent.talent_id == talent_id
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Talent not linked to this video")
    await db.delete(link)
