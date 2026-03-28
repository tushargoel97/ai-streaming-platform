from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator

from app.storage.urls import resolve_media_url


class VideoSummary(BaseModel):
    """Lightweight video representation for recommendations (no relations)."""
    id: UUID
    title: str
    slug: str
    description: str
    duration: float
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
    file_size: int
    original_filename: str | None = None
    source_width: int | None = None
    source_height: int | None = None

    # Resolved URLs
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


class RecommendationSection(BaseModel):
    title: str
    videos: list[VideoSummary]


class PersonalizedFeedResponse(BaseModel):
    sections: list[RecommendationSection]
