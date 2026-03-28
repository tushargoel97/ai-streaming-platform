"""AI settings — singleton table for platform-wide AI configuration."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AISettings(Base):
    __tablename__ = "ai_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # LLM mode
    use_external_llm: Mapped[bool] = mapped_column(Boolean, default=False)
    external_provider: Mapped[str] = mapped_column(String(20), default="anthropic")
    external_api_key: Mapped[str] = mapped_column(Text, default="")
    external_model: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-5-20241022")

    # Local LLM
    local_model: Mapped[str] = mapped_column(String(100), default="qwen2.5-3b")

    # Embedding
    embedding_model: Mapped[str] = mapped_column(String(100), default="all-MiniLM-L6-v2")

    # Feature toggles
    auto_analyze_uploads: Mapped[bool] = mapped_column(Boolean, default=True)
    smart_search_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    recommendation_reasons: Mapped[bool] = mapped_column(Boolean, default=False)

    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
