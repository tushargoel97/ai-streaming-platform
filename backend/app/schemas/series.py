from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SeasonCreateRequest(BaseModel):
    season_number: int
    title: str = ""
    description: str = ""
    poster_url: str = ""


class SeasonUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    poster_url: str | None = None


class SeasonResponse(BaseModel):
    id: UUID
    series_id: UUID
    season_number: int
    title: str
    description: str
    poster_url: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SeriesCreateRequest(BaseModel):
    title: str
    description: str = ""
    poster_url: str = ""
    banner_url: str = ""
    content_classification: str = "safe"
    status: str = "ongoing"
    year_started: int | None = None
    tags: list[str] = []


class SeriesUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    poster_url: str | None = None
    banner_url: str | None = None
    content_classification: str | None = None
    status: str | None = None
    year_started: int | None = None
    tags: list[str] | None = None


class SeriesResponse(BaseModel):
    id: UUID
    title: str
    slug: str
    description: str
    poster_url: str
    banner_url: str
    content_classification: str
    status: str
    year_started: int | None = None
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SeriesDetailResponse(SeriesResponse):
    seasons: list[SeasonResponse] = []


class SeriesListResponse(BaseModel):
    items: list[SeriesResponse]
    total: int
    page: int
    page_size: int


class EpisodeAssignRequest(BaseModel):
    series_id: UUID
    season_id: UUID
    episode_number: int
