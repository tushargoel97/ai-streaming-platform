from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator

from app.storage.urls import resolve_media_url


class AudioTrackResponse(BaseModel):
    id: UUID
    language: str
    label: str
    is_default: bool

    model_config = {"from_attributes": True}


class SubtitleTrackResponse(BaseModel):
    id: UUID
    language: str
    label: str
    format: str
    file_path: str
    is_default: bool
    file_url: str = ""

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _resolve_urls(self):
        if self.file_path and not self.file_url:
            self.file_url = resolve_media_url(self.file_path)
        return self


class VideoQualityResponse(BaseModel):
    id: UUID
    quality_name: str
    width: int
    height: int
    bitrate: int

    model_config = {"from_attributes": True}


class VideoTalentResponse(BaseModel):
    talent_id: UUID
    role: str
    talent_name: str | None = None
    talent_slug: str | None = None
    talent_photo_url: str | None = None

    model_config = {"from_attributes": True}


class VideoResponse(BaseModel):
    id: UUID
    title: str
    slug: str
    description: str
    original_filename: str | None = None
    duration: float
    source_width: int | None = None
    source_height: int | None = None
    file_size: int
    thumbnail_path: str | None = None
    manifest_path: str | None = None
    status: str
    content_classification: str
    view_count: int
    is_featured: bool
    tags: list[str]
    imdb_rating: float | None = None
    rotten_tomatoes_score: int | None = None
    metacritic_score: int | None = None
    series_id: UUID | None = None
    season_id: UUID | None = None
    episode_number: int | None = None
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    min_tier_level: int = 0
    category_ids: list[UUID] = []
    tenant_ids: list[UUID] = []
    qualities: list[VideoQualityResponse] = []
    audio_tracks: list[AudioTrackResponse] = []
    subtitle_tracks: list[SubtitleTrackResponse] = []

    # Resolved URLs (populated by validator from *_path fields)
    thumbnail_url: str = ""
    manifest_url: str = ""

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _resolve_urls(self):
        if self.manifest_path and not self.manifest_url:
            self.manifest_url = resolve_media_url(self.manifest_path)
        if self.thumbnail_path and not self.thumbnail_url:
            self.thumbnail_url = resolve_media_url(self.thumbnail_path)
        return self

    @classmethod
    def from_video(cls, video: object) -> "VideoResponse":
        """Build response from a Video ORM instance with eagerly-loaded categories."""
        data: dict = {}
        for c in video.__table__.columns:  # type: ignore[attr-defined]
            data[c.key] = getattr(video, c.key)
        cats = getattr(video, "categories", None)
        data["category_ids"] = [vc.category_id for vc in cats] if cats else []
        tenants = getattr(video, "tenant_videos", None)
        data["tenant_ids"] = [tv.tenant_id for tv in tenants] if tenants else []
        return cls(**data)


class VideoUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    content_classification: str | None = None
    is_featured: bool | None = None
    tags: list[str] | None = None
    category_ids: list[UUID] | None = None
    tenant_ids: list[UUID] | None = None
    min_tier_level: int | None = None
    series_id: UUID | None = None
    season_id: UUID | None = None
    episode_number: int | None = None


class VideoListResponse(BaseModel):
    items: list[VideoResponse]
    total: int
    page: int
    page_size: int
