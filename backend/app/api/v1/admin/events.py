import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.permissions import require_admin
from app.database import get_db
from app.models.match import Event, EventHighlight
from app.models.tournament import Competition
from app.models.live import LiveStream
from app.models.video import Video
from app.models.user import User
from app.tenant.context import get_tenant_id

router = APIRouter(prefix="/admin/events", tags=["admin-events"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class EventCreate(BaseModel):
    competition_id: uuid.UUID
    title: str
    description: str = ""
    event_type: str = "match"
    round_label: str = ""
    participant_1: str = ""
    participant_2: str = ""
    venue: str = ""
    scheduled_at: datetime
    status: str = "scheduled"


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    event_type: str | None = None
    round_label: str | None = None
    participant_1: str | None = None
    participant_2: str | None = None
    venue: str | None = None
    scheduled_at: datetime | None = None
    status: str | None = None
    score_1: int | None = None
    score_2: int | None = None
    result_data: dict | None = None
    live_stream_id: uuid.UUID | None = None
    replay_video_id: uuid.UUID | None = None


class LinkStreamRequest(BaseModel):
    live_stream_id: uuid.UUID


class LinkReplayRequest(BaseModel):
    video_id: uuid.UUID


class HighlightCreate(BaseModel):
    video_id: uuid.UUID
    title: str
    timestamp_in_event: int | None = None
    highlight_type: str = "other"
    sort_order: int = 0


class HighlightUpdate(BaseModel):
    title: str | None = None
    timestamp_in_event: int | None = None
    highlight_type: str | None = None
    sort_order: int | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text


def _serialize_event(e: Event, highlight_count: int = 0) -> dict:
    return {
        "id": str(e.id),
        "tenant_id": str(e.tenant_id),
        "competition_id": str(e.competition_id),
        "competition_name": e.competition.name if e.competition else "",
        "title": e.title,
        "slug": e.slug,
        "description": e.description,
        "event_type": e.event_type,
        "round_label": e.round_label,
        "participant_1": e.participant_1,
        "participant_2": e.participant_2,
        "venue": e.venue,
        "scheduled_at": e.scheduled_at.isoformat() if e.scheduled_at else None,
        "status": e.status,
        "score_1": e.score_1,
        "score_2": e.score_2,
        "result_data": e.result_data,
        "live_stream_id": str(e.live_stream_id) if e.live_stream_id else None,
        "replay_video_id": str(e.replay_video_id) if e.replay_video_id else None,
        "highlight_count": highlight_count,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _serialize_highlight(h: EventHighlight) -> dict:
    return {
        "id": str(h.id),
        "event_id": str(h.event_id),
        "video_id": str(h.video_id),
        "title": h.title,
        "timestamp_in_event": h.timestamp_in_event,
        "highlight_type": h.highlight_type,
        "sort_order": h.sort_order,
        "video_title": h.video.title if h.video else "",
        "video_thumbnail_url": "",
        "video_duration": h.video.duration if h.video else 0,
        "created_at": h.created_at.isoformat() if h.created_at else None,
    }


# ── Event Endpoints ─────────────────────────────────────────────────────────


@router.get("")
async def list_events(
    competition_id: uuid.UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()
    query = (
        select(Event)
        .where(Event.tenant_id == tid)
        .options(selectinload(Event.competition))
    )

    if competition_id:
        query = query.where(Event.competition_id == competition_id)
    if status_filter:
        query = query.where(Event.status == status_filter)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Event.scheduled_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    events = result.scalars().all()

    items = []
    for e in events:
        hc = (await db.execute(
            select(func.count()).where(EventHighlight.event_id == e.id)
        )).scalar() or 0
        items.append(_serialize_event(e, hc))

    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{event_id}")
async def get_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Event)
        .where(Event.id == event_id)
        .options(
            selectinload(Event.competition),
            selectinload(Event.highlights).selectinload(EventHighlight.video),
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    data = _serialize_event(event, len(event.highlights))
    data["highlights"] = [_serialize_highlight(h) for h in event.highlights]
    return data


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
    tenant_id: uuid.UUID | None = None,
):
    tid = tenant_id or get_tenant_id()

    # Verify competition exists and belongs to tenant
    comp = await db.execute(
        select(Competition).where(
            Competition.id == body.competition_id,
            Competition.tenant_id == tid,
        )
    )
    if not comp.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Competition not found for this tenant")

    base_slug = _slugify(body.title)
    existing = await db.execute(
        select(Event).where(Event.tenant_id == tid, Event.slug == base_slug)
    )
    if existing.scalar_one_or_none():
        base_slug = f"{base_slug}-{uuid.uuid4().hex[:6]}"

    event = Event(
        tenant_id=tid,
        competition_id=body.competition_id,
        title=body.title,
        slug=base_slug,
        description=body.description,
        event_type=body.event_type,
        round_label=body.round_label,
        participant_1=body.participant_1,
        participant_2=body.participant_2,
        venue=body.venue,
        scheduled_at=body.scheduled_at,
        status=body.status,
    )
    db.add(event)
    await db.flush()
    await db.refresh(event, ["competition"])
    return _serialize_event(event)


@router.patch("/{event_id}")
async def update_event(
    event_id: uuid.UUID,
    body: EventUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Event)
        .where(Event.id == event_id)
        .options(selectinload(Event.competition))
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    update_data = body.model_dump(exclude_unset=True)

    # Validate live_stream_id if provided
    if "live_stream_id" in update_data and update_data["live_stream_id"]:
        stream = await db.execute(
            select(LiveStream).where(LiveStream.id == update_data["live_stream_id"])
        )
        if not stream.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Live stream not found")

    # Validate replay_video_id if provided
    if "replay_video_id" in update_data and update_data["replay_video_id"]:
        video = await db.execute(
            select(Video).where(Video.id == update_data["replay_video_id"])
        )
        if not video.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Video not found")

    for field, value in update_data.items():
        setattr(event, field, value)

    event.updated_at = datetime.utcnow()
    await db.flush()
    await db.refresh(event, ["competition"])
    return _serialize_event(event)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)


# ── Link Stream / Replay ────────────────────────────────────────────────────


@router.post("/{event_id}/link-stream")
async def link_stream_to_event(
    event_id: uuid.UUID,
    body: LinkStreamRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Event).where(Event.id == event_id).options(selectinload(Event.competition))
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    stream = await db.execute(
        select(LiveStream).where(
            LiveStream.id == body.live_stream_id,
            LiveStream.tenant_id == event.tenant_id,
        )
    )
    if not stream.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Live stream not found for this tenant")

    event.live_stream_id = body.live_stream_id
    event.updated_at = datetime.utcnow()
    await db.flush()
    return _serialize_event(event)


@router.post("/{event_id}/link-replay")
async def link_replay_to_event(
    event_id: uuid.UUID,
    body: LinkReplayRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Event).where(Event.id == event_id).options(selectinload(Event.competition))
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    video = await db.execute(select(Video).where(Video.id == body.video_id))
    if not video.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Video not found")

    event.replay_video_id = body.video_id
    event.updated_at = datetime.utcnow()
    await db.flush()
    return _serialize_event(event)


# ── Highlight Endpoints ──────────────────────────────────────────────────────


@router.get("/{event_id}/highlights")
async def list_highlights(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(EventHighlight)
        .where(EventHighlight.event_id == event_id)
        .options(selectinload(EventHighlight.video))
        .order_by(EventHighlight.sort_order, EventHighlight.timestamp_in_event.nullslast())
    )
    highlights = result.scalars().all()
    return {"items": [_serialize_highlight(h) for h in highlights]}


@router.post("/{event_id}/highlights", status_code=status.HTTP_201_CREATED)
async def add_highlight(
    event_id: uuid.UUID,
    body: HighlightCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    # Verify event exists
    event = await db.execute(select(Event).where(Event.id == event_id))
    if not event.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Event not found")

    # Verify video exists
    video = await db.execute(select(Video).where(Video.id == body.video_id))
    if not video.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Video not found")

    highlight = EventHighlight(
        event_id=event_id,
        video_id=body.video_id,
        title=body.title,
        timestamp_in_event=body.timestamp_in_event,
        highlight_type=body.highlight_type,
        sort_order=body.sort_order,
    )
    db.add(highlight)
    await db.flush()
    await db.refresh(highlight, ["video"])
    return _serialize_highlight(highlight)


@router.patch("/{event_id}/highlights/{highlight_id}")
async def update_highlight(
    event_id: uuid.UUID,
    highlight_id: uuid.UUID,
    body: HighlightUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(EventHighlight)
        .where(EventHighlight.id == highlight_id, EventHighlight.event_id == event_id)
        .options(selectinload(EventHighlight.video))
    )
    highlight = result.scalar_one_or_none()
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(highlight, field, value)

    await db.flush()
    return _serialize_highlight(highlight)


@router.delete("/{event_id}/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_highlight(
    event_id: uuid.UUID,
    highlight_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    result = await db.execute(
        select(EventHighlight).where(
            EventHighlight.id == highlight_id, EventHighlight.event_id == event_id
        )
    )
    highlight = result.scalar_one_or_none()
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    await db.delete(highlight)
