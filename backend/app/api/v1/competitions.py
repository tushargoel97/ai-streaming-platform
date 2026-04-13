"""Public competition & event API.

Endpoints:
  GET  /competitions                  — list active competitions for current tenant
  GET  /competitions/{slug}           — competition detail with upcoming events
  GET  /events/upcoming               — upcoming events across all competitions
  GET  /events/live                   — currently live events
  GET  /events/{slug}                 — event detail with stream/replay/highlights
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.tournament import Competition
from app.models.match import Event, EventHighlight

router = APIRouter(tags=["competitions"])


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_competition(c: Competition, event_count: int = 0) -> dict:
    return {
        "id": str(c.id),
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
    }


def _serialize_event(e: Event) -> dict:
    return {
        "id": str(e.id),
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
        "video_duration": h.video.duration if h.video else 0,
    }


# ── Competition Endpoints ────────────────────────────────────────────────────


@router.get("/competitions")
async def list_competitions(
    request: Request,
    category_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List active competitions for the current tenant."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return {"items": []}

    query = (
        select(Competition)
        .where(
            Competition.tenant_id == tenant.id,
            Competition.status.in_(["upcoming", "active"]),
        )
        .options(selectinload(Competition.category))
    )

    if category_id:
        query = query.where(Competition.category_id == category_id)

    query = query.order_by(Competition.start_date.asc().nullslast())
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

    items = [_serialize_competition(c, event_counts.get(c.id, 0)) for c in comps]
    return {"items": items}


@router.get("/competitions/{slug}")
async def get_competition(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get competition detail with its events."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=404, detail="Competition not found")

    result = await db.execute(
        select(Competition)
        .where(Competition.tenant_id == tenant.id, Competition.slug == slug)
        .options(selectinload(Competition.category))
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")

    # Fetch events
    events_result = await db.execute(
        select(Event)
        .where(Event.competition_id == comp.id)
        .options(selectinload(Event.competition))
        .order_by(Event.scheduled_at.asc())
    )
    events = events_result.scalars().all()

    ec = len(events)
    data = _serialize_competition(comp, ec)
    data["events"] = [_serialize_event(e) for e in events]
    return data


# ── Event Endpoints ──────────────────────────────────────────────────────────


@router.get("/events/upcoming")
async def upcoming_events(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Upcoming events across all competitions for current tenant."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return {"items": []}

    from datetime import datetime, timezone
    result = await db.execute(
        select(Event)
        .where(
            Event.tenant_id == tenant.id,
            Event.status == "scheduled",
            Event.scheduled_at >= datetime.now(timezone.utc).replace(tzinfo=None),
        )
        .options(selectinload(Event.competition))
        .order_by(Event.scheduled_at.asc())
        .limit(limit)
    )
    events = result.scalars().all()
    return {"items": [_serialize_event(e) for e in events]}


@router.get("/events/live")
async def live_events(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Currently live events for current tenant."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        return {"items": []}

    result = await db.execute(
        select(Event)
        .where(Event.tenant_id == tenant.id, Event.status == "live")
        .options(selectinload(Event.competition))
        .order_by(Event.scheduled_at.desc())
    )
    events = result.scalars().all()
    return {"items": [_serialize_event(e) for e in events]}


@router.get("/events/{slug}")
async def get_event(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Event detail with stream/replay/highlights."""
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=404, detail="Event not found")

    result = await db.execute(
        select(Event)
        .where(Event.tenant_id == tenant.id, Event.slug == slug)
        .options(
            selectinload(Event.competition),
            selectinload(Event.highlights).selectinload(EventHighlight.video),
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    data = _serialize_event(event)
    data["highlights"] = [_serialize_highlight(h) for h in event.highlights]
    return data
