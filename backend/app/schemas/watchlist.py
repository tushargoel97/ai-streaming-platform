from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.video import VideoResponse


class WatchlistItemResponse(BaseModel):
    id: UUID
    video_id: UUID
    added_at: datetime
    video: VideoResponse | None = None

    model_config = {"from_attributes": True}


class WatchlistResponse(BaseModel):
    items: list[WatchlistItemResponse]
    total: int
    page: int
    page_size: int


class ReactionRequest(BaseModel):
    reaction: str  # "like" or "dislike"


class ReactionResponse(BaseModel):
    user_reaction: str | None = None  # "like", "dislike", or None
