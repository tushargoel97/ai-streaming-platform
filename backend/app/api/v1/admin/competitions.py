import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import require_admin
from app.database import get_db
from app.models.tournament import Competition
from app.models.match import Event
from app.models.user import User
from app.tenant.context import get_tenant_id
from app.utils.slug import slugify

router = APIRouter(prefix="/admin/competitions", tags=["admin-competitions"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class CompetitionCreate(BaseModel):
    name: str
    category_id: uuid.UUID
    description: str = ""
    logo_url: str = ""
    competition_type: str = "tournament"
    season: str | None = None
    year: int | None = None
    status: str = "upcoming"
    start_date: datetime | None = None
    end_date: datetime | None = None


class CompetitionUpdate(BaseModel):
    name: str | None = None
    category_id: uuid.UUID | None = None
    description: str | None = None
    logo_url: str | None = None
    competition_type: str | None = None
    season: str | None = None
    year: int | None = None
    status: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize(c: Competition, event_count: int = 0) -> dict:
    return {
        "id": str(c.id),
        "tenant_id": str(c.tenant_id),
        "category_id": str(c.category_id),
        "category_name": c.category.name if c.category else "",
        "name": c.name,
        "slug": c.slug,
        "description": c.description,
        "logo_url": c.logo_url,
        "competition_type": c.competition_type,
        "season": c.season,
        "year": c.year,
        "status": c.status,
        "start_date": c.start_date.isoformat() if c.start_date else None,
        "end_date": c.end_date.isoformat() if c.end_date else None,
        "event_count": event_count,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("")
async def list_competitions(
    search: str | None = None,
    category_id: uuid.UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()
    query = (
        select(Competition)
        .where(Competition.tenant_id == tid)
        .options(selectinload(Competition.category))
    )

    if search:
        query = query.where(Competition.name.ilike(f"%{search}%"))
    if category_id:
        query = query.where(Competition.category_id == category_id)
    if status_filter:
        query = query.where(Competition.status == status_filter)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Competition.start_date.desc().nullslast(), Competition.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    comps = result.scalars().all()

    # Batch event counts in one query
    comp_ids = [c.id for c in comps]
    event_counts: dict = {}
    if comp_ids:
        count_rows = await db.execute(
            select(Event.competition_id, func.count())
            .where(Event.competition_id.in_(comp_ids))
            .group_by(Event.competition_id)
        )
        event_counts = dict(count_rows.all())

    items = [_serialize(c, event_counts.get(c.id, 0)) for c in comps]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{competition_id}")
async def get_competition(
    competition_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Competition)
        .where(Competition.id == competition_id)
        .options(selectinload(Competition.category))
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    count_result = await db.execute(
        select(func.count()).where(Event.competition_id == comp.id)
    )
    event_count = count_result.scalar() or 0
    return _serialize(comp, event_count)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_competition(
    body: CompetitionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()

    base_slug = slugify(body.name)
    existing = await db.execute(
        select(Competition).where(
            Competition.tenant_id == tid,
            Competition.slug == base_slug,
        )
    )
    if existing.scalar_one_or_none():
        base_slug = f"{base_slug}-{uuid.uuid4().hex[:6]}"

    comp = Competition(
        tenant_id=tid,
        category_id=body.category_id,
        name=body.name,
        slug=base_slug,
        description=body.description,
        logo_url=body.logo_url,
        competition_type=body.competition_type,
        season=body.season,
        year=body.year,
        status=body.status,
        start_date=body.start_date,
        end_date=body.end_date,
    )
    db.add(comp)
    await db.flush()
    await db.refresh(comp, ["category"])
    return _serialize(comp)


@router.patch("/{competition_id}")
async def update_competition(
    competition_id: uuid.UUID,
    body: CompetitionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Competition)
        .where(Competition.id == competition_id)
        .options(selectinload(Competition.category))
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(comp, field, value)

    comp.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(comp, ["category"])
    return _serialize(comp)


@router.delete("/{competition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_competition(
    competition_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Competition).where(Competition.id == competition_id)
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    await db.delete(comp)
