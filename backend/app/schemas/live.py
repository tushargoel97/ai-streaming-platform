import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


# ─── Admin Request Schemas ────────────────────────────────────────────────────

class LiveStreamCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = ""
    category_id: Optional[uuid.UUID] = None
    is_ppv: bool = False
    ppv_price: Optional[Decimal] = None
    ppv_currency: str = "USD"


class LiveStreamUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
    is_ppv: Optional[bool] = None
    ppv_price: Optional[Decimal] = None
    ppv_currency: Optional[str] = None


# ─── Response Schemas ─────────────────────────────────────────────────────────

class LiveStreamPublic(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    status: str
    category_id: Optional[uuid.UUID] = None
    category_name: str = ""
    manifest_url: str = ""
    thumbnail_url: str = ""
    viewer_count: int = 0
    started_at: Optional[datetime] = None
    is_ppv: bool = False
    ppv_price: Optional[str] = None
    ppv_currency: str = "USD"

    model_config = {"from_attributes": True}


class LiveStreamAdmin(LiveStreamPublic):
    stream_key: str
    peak_viewers: int = 0
    tenant_id: uuid.UUID
    created_by: Optional[uuid.UUID] = None
    ended_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LiveStreamCreated(BaseModel):
    id: uuid.UUID
    title: str
    stream_key: str
    rtmp_url: str
    status: str


# ─── Chat Schemas ─────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    type: str = "message"  # message | system | viewer_count
    username: str = ""
    content: str = ""
    viewer_count: int = 0
    timestamp: Optional[datetime] = None
