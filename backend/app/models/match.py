import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    competition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("competitions.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    slug: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    event_type: Mapped[str] = mapped_column(String(30), default="match")
    # match | race | grand_prix | bout | round | qualifier | practice | ceremony
    round_label: Mapped[str] = mapped_column(String(100), default="")
    # e.g. "Quarter-Final", "Round 5", "Race 12", "Group Stage"

    # Participants (generic — works for teams, drivers, fighters, etc.)
    participant_1: Mapped[str] = mapped_column(String(255), default="")
    participant_2: Mapped[str] = mapped_column(String(255), default="")
    venue: Mapped[str] = mapped_column(String(255), default="")

    scheduled_at: Mapped[datetime] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    # scheduled | live | completed | cancelled | postponed

    # Simple scores (for 1v1 events like football, tennis, boxing)
    score_1: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    score_2: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Complex results (for multi-participant events like F1, or detailed stats)
    result_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # e.g. F1: {"positions": [{"driver": "Verstappen", "time": "1:32:45"}], "fastest_lap": "Hamilton"}
    # e.g. Football: {"possession": [55, 45], "shots": [12, 8], "corners": [6, 3]}

    # Link to live stream (set when stream starts)
    live_stream_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("live_streams.id", ondelete="SET NULL"), nullable=True
    )
    # Link to replay VOD (set after stream ends)
    replay_video_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    competition: Mapped["Competition"] = relationship(back_populates="events")
    live_stream: Mapped[Optional["LiveStream"]] = relationship()
    replay_video: Mapped[Optional["Video"]] = relationship(foreign_keys=[replay_video_id])
    highlights: Mapped[list["EventHighlight"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class EventHighlight(Base):
    __tablename__ = "event_highlights"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    timestamp_in_event: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # seconds from event start
    highlight_type: Mapped[str] = mapped_column(String(50), default="other")
    # goal | save | red_card | penalty | overtake | crash | podium | knockout | other
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    event: Mapped["Event"] = relationship(back_populates="highlights")
    video: Mapped["Video"] = relationship()
