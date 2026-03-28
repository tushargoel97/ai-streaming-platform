from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class TalentCreateRequest(BaseModel):
    name: str
    bio: str = ""
    photo_url: str = ""
    birth_date: date | None = None


class TalentUpdateRequest(BaseModel):
    name: str | None = None
    bio: str | None = None
    photo_url: str | None = None
    birth_date: date | None = None


class TalentResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    bio: str
    photo_url: str
    birth_date: date | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TalentDetailResponse(TalentResponse):
    video_count: int = 0


class TalentListResponse(BaseModel):
    items: list[TalentResponse]
    total: int
    page: int
    page_size: int


class VideoTalentRequest(BaseModel):
    role: str = ""
    sort_order: int = 0
