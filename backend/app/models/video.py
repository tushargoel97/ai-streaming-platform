import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, Integer, Float, BigInteger, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Episode info (NULL for standalone videos)
    series_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="SET NULL"), nullable=True
    )
    season_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seasons.id", ondelete="SET NULL"), nullable=True
    )
    episode_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    slug: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)

    # Source file info
    original_filename: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    duration: Mapped[float] = mapped_column(Float, default=0)
    source_width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_codec: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)

    # Streaming
    manifest_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # AI-selected preview start time (seconds into video) — avoids title cards
    preview_start_time: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Intro detection (seconds) — used for "Skip Intro" button
    intro_start: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    intro_end: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), default="uploading")

    # Content safety classification
    content_classification: Mapped[str] = mapped_column(String(10), nullable=False, default="safe")

    # Subscription gating — minimum tier level required to watch (0 = free)
    min_tier_level: Mapped[int] = mapped_column(Integer, default=0)

    # External ratings (auto-enriched from OMDB/TMDB, editable by admin)
    imdb_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rotten_tomatoes_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    metacritic_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    external_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Metadata
    view_count: Mapped[int] = mapped_column(BigInteger, default=0)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)

    # Timestamps
    published_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    qualities: Mapped[list["VideoQuality"]] = relationship(back_populates="video", cascade="all, delete-orphan")
    audio_tracks: Mapped[list["AudioTrack"]] = relationship(back_populates="video", cascade="all, delete-orphan")
    subtitle_tracks: Mapped[list["SubtitleTrack"]] = relationship(back_populates="video", cascade="all, delete-orphan")
    talents: Mapped[list["VideoTalent"]] = relationship(cascade="all, delete-orphan")
    categories: Mapped[list["VideoCategory"]] = relationship(cascade="all, delete-orphan", back_populates="video")
    tenant_videos: Mapped[list["TenantVideo"]] = relationship("TenantVideo", cascade="all, delete-orphan")


class VideoCategory(Base):
    __tablename__ = "video_categories"

    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )

    video: Mapped["Video"] = relationship(back_populates="categories")


class VideoQuality(Base):
    __tablename__ = "video_qualities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False
    )
    quality_name: Mapped[str] = mapped_column(String(10), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    bitrate: Mapped[int] = mapped_column(Integer, nullable=False)
    playlist_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    segment_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    video: Mapped["Video"] = relationship(back_populates="qualities")


class VideoTalent(Base):
    __tablename__ = "video_talents"

    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    talent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("talents.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(100), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class AudioTrack(Base):
    __tablename__ = "audio_tracks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False
    )
    language: Mapped[str] = mapped_column(String(10), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    track_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    video: Mapped["Video"] = relationship(back_populates="audio_tracks")


class SubtitleTrack(Base):
    __tablename__ = "subtitle_tracks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False
    )
    language: Mapped[str] = mapped_column(String(10), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    format: Mapped[str] = mapped_column(String(10), nullable=False, default="vtt")
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    video: Mapped["Video"] = relationship(back_populates="subtitle_tracks")
